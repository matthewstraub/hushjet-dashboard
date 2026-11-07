"""hushjet: log in to MyDyson once, find the HushJet, and record its readings.

  hushjet login     sign in with the code Dyson emails you; saves the token
  hushjet devices   list the account's devices, firmware and LAN addresses
  hushjet listen    stream state and PM readings into SQLite and the terminal,
                    from the home network or, with --cloud, through Dyson's cloud
  hushjet show      print the latest readings from SQLite
  hushjet replay    rebuild readings from raw JSONL captures
"""

from __future__ import annotations

import argparse
import getpass
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from dotenv import find_dotenv, load_dotenv

from . import __version__
from .appapi import ApiError, AuthError, DysonAppAPI, RateLimited
from .cloud import CLOUD_PORT, CloudAuth
from .config import ConfigError, Settings, read_private_json, write_private_json
from .credentials import CredentialError, decrypt_local_credential
from .devices import Device, Manifest, choose_device, fetch_manifest
from .discovery import Found, discover
from .display import TablePrinter
from .listener import Listener, ListenError, ListenStats, Target, utc_stamp
from .messages import Reading
from .redact import redact
from .store import Pipeline, RawLog, Store, replay


class CliError(Exception):
    """A problem to report in one line, without a traceback."""


# `listen --cloud` connects to the endpoint Dyson names on CLOUD_PORT over TLS.
# Tests point these at a fake broker on localhost.
CLOUD_TLS = True


def make_api(settings: Settings, token: str | None = None) -> DysonAppAPI:
    """Build the App API client. Tests replace this to use a fake transport."""
    return DysonAppAPI(
        settings.api_base,
        user_agent=settings.user_agent,
        country=settings.country,
        culture=settings.culture,
        token=token,
    )


def main(argv: list[str] | None = None, env: Mapping[str, str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )
    # These libraries log request details at debug level; keep them quiet.
    for noisy in ("httpx", "httpcore", "zeroconf"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    if env is None:
        load_dotenv(find_dotenv(usecwd=True))
        env = os.environ
    try:
        settings = Settings.from_env(env)
        return int(args.handler(args, settings))
    except (CliError, ConfigError, ApiError, CredentialError, ListenError, LookupError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print(file=sys.stderr)
        return 130


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="hushjet",
        description=(
            "Read a Dyson HushJet Purifier Compact (HJ10) over MQTT, on the home network "
            "or through Dyson's cloud."
        ),
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="debug logging (never includes secrets)"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("login", help="sign in with the code Dyson emails you and save the token")
    p.add_argument("--force", action="store_true", help="request a new code even if a token is saved")
    p.set_defaults(handler=cmd_login)

    p = sub.add_parser("devices", help="list the account's devices and find them on the LAN")
    p.add_argument("--no-discover", action="store_true", help="skip the mDNS search")
    p.add_argument(
        "--discover-seconds", type=positive_float, default=5.0, help="mDNS search time (default 5)"
    )
    p.set_defaults(handler=cmd_devices)

    p = sub.add_parser("listen", help="stream state and sensor data into SQLite and the terminal")
    p.add_argument("--serial", help="which device, when the account has more than one")
    p.add_argument(
        "--cloud",
        action="store_true",
        help="connect through Dyson's cloud (AWS IoT) instead of the home network",
    )
    p.add_argument("--host", help="the purifier's IP address (skips mDNS)")
    p.add_argument("--port", type=int, help="MQTT port (default 1883)")
    p.add_argument(
        "--interval", type=positive_float, help="seconds between sensor requests (default 30)"
    )
    p.add_argument("--duration", type=parse_duration, help="stop after this long: 90, 15m or 1h")
    p.add_argument(
        "--offline", action="store_true", help="use the cached device list; don't call the cloud"
    )
    p.add_argument("--quiet", action="store_true", help="don't print a table row per message")
    p.set_defaults(handler=cmd_listen)

    p = sub.add_parser("show", help="print the latest readings from SQLite")
    p.add_argument("--last", type=int, default=20, help="how many rows (default 20)")
    p.set_defaults(handler=cmd_show)

    p = sub.add_parser("replay", help="rebuild readings from raw JSONL captures")
    p.add_argument("files", nargs="+", type=Path)
    p.add_argument("--db", type=Path, help="SQLite file to write (default data/replay.db)")
    p.add_argument("--append", action="store_true", help="add to a database that already has rows")
    p.set_defaults(handler=cmd_replay)
    return parser


# --- login -----------------------------------------------------------------------------


def cmd_login(args: argparse.Namespace, settings: Settings) -> int:
    saved = read_private_json(settings.auth_file)
    if saved and not args.force:
        print(f"Already logged in as {saved.get('email')} (token saved {age(saved.get('saved_at'))} ago).")
        print("Run `hushjet login --force` to request a new emailed code.")
        return 0

    email = settings.email or input("MyDyson email: ").strip()
    if not email:
        raise CliError("An email address is needed; set DYSON_EMAIL in .env")
    # Ask for the password before requesting the code, so the code isn't left waiting.
    password = settings.password or getpass.getpass("MyDyson password: ")
    if not password:
        raise CliError("A password is needed")

    try:
        with make_api(settings) as api:
            api.provision()
            status = api.user_status(email)
            if status.get("accountStatus") != "ACTIVE":
                raise CliError(
                    f"Dyson reports account status {status.get('accountStatus')!r} for {email}"
                )
            method = status.get("authenticationMethod")
            if method != "EMAIL_PWD_2FA":
                print(
                    f"warning: the account uses {method!r}; this tool only knows the emailed code flow",
                    file=sys.stderr,
                )
            challenge_id = api.begin_login(email)
            print(f"Dyson emailed a one-time code to {email}.")
            code = input("Code: ").strip()
            try:
                response = api.complete_login(
                    email=email, password=password, challenge_id=challenge_id, otp_code=code
                )
            except ApiError as exc:
                if exc.status in (400, 401, 403):
                    raise CliError(
                        "Dyson rejected the code or the password. Check both, wait a minute, "
                        "then run `hushjet login --force`."
                    ) from None
                raise
    except RateLimited:
        raise CliError(
            "Dyson is rate limiting (429), usually from too many code requests. "
            "Wait a while before trying again."
        ) from None

    write_private_json(
        settings.auth_file,
        {"email": email, "country": settings.country, "saved_at": utc_stamp(), "response": response},
    )
    print(f"Logged in. The token is saved, owner-only, in {settings.auth_file}")
    # Field names only: shows whether Dyson ever starts sending an expiry.
    print(f"Login response fields: {', '.join(sorted(response))}")
    print("Next: hushjet devices")
    return 0


# --- devices ---------------------------------------------------------------------------


def cmd_devices(args: argparse.Namespace, settings: Settings) -> int:
    saved = load_auth(settings)
    manifest = refresh_manifest(settings, saved)
    found: dict[str, Found] = {}
    if not args.no_discover:
        found = safe_discover(args.discover_seconds)
        for hit in found.values():
            remember_host(settings, hit)

    rows = []
    for device in manifest.devices:
        hit = found.get(device.serial.upper())
        rows.append(
            [
                device.serial,
                device.name or "-",
                device.product_type or "-",
                device.topic_root or "-",
                device.model or "-",
                device.variant or "-",
                device.firmware_version or "-",
                _yes_no(device.new_version_available),
                _credential_status(device),
                f"{hit.host}:{hit.port}" if hit else "-",
            ]
        )
    headers = [
        "serial", "name", "type", "topic", "model", "variant",
        "firmware", "update", "credential", "lan address",
    ]  # fmt: skip
    print_table(headers, rows)
    for note in manifest.notes:
        print(f"note: {note}")

    for device in manifest.devices:
        if device.is_hushjet:
            entry = next(
                (e for e in manifest.raw if (e.get("serialNumber") or e.get("Serial")) == device.serial),
                None,
            )
            print(f"\nManifest entry for {device.label} (credentials redacted):")
            print(json.dumps(redact(entry), indent=2))
    if not any(device.is_hushjet for device in manifest.devices):
        print("\nNo HushJet (product type 897) on this account.")
    if not args.no_discover and not found:
        print("\nmDNS found nothing; set DYSON_HOST in .env or pass --host to `listen`.")
    print(f"\nToken age: {age(saved.get('saved_at'))}. Device list cached in {settings.devices_file}")
    return 0


def _yes_no(value: bool | None) -> str:
    return "-" if value is None else ("yes" if value else "no")


def _credential_status(device: Device) -> str:
    if device.credential_source:
        return f"ok ({device.credential_source})"
    return "won't decrypt" if device.local_credential else "none"


def print_table(headers: list[str], rows: list[list[str]]) -> None:
    widths = [max(len(str(cell)) for cell in column) for column in zip(headers, *rows)]
    for line in (headers, *rows):
        print("  ".join(str(cell).ljust(width) for cell, width in zip(line, widths)).rstrip())


# --- listen ----------------------------------------------------------------------------


def cmd_listen(args: argparse.Namespace, settings: Settings) -> int:
    if args.cloud and (args.offline or args.host or args.port):
        raise CliError(
            "--cloud gets its address and credentials from Dyson, so it can't be combined "
            "with --offline, --host or --port"
        )
    device = choose_device(listen_devices(settings, offline=args.offline), args.serial or settings.serial)
    topic_root = device.topic_root or device.product_type
    if not topic_root:
        raise CliError(f"The manifest gives no MQTT topic prefix for {device.serial}")
    if args.cloud:
        target, how = cloud_target(settings, device, topic_root)
    else:
        target, how = local_target(args, settings, device, topic_root)
    interval = args.interval or settings.poll_seconds

    update = " (update available)" if device.new_version_available else ""
    print(
        f"{device.label} ({device.serial}), product type {device.product_type}, "
        f"firmware {device.firmware_version or 'unknown'}{update}"
    )
    where = f"through {target.where}" if target.cloud else f"at {target.where} ({how})"
    print(f"Listening {where}, asking for sensor data every {interval:g}s. Ctrl-C stops.")

    printer = TablePrinter()
    warned: set[str] = set()

    def on_reading(reading: Reading) -> None:
        if not args.quiet:
            printer.row(reading)
        if reading.monitoring is False and "monitoring" not in warned:
            warned.add("monitoring")
            print(
                "note: continuous monitoring (rhtm) is off, so the purifier only measures air "
                "quality while running. Turn it on in the MyDyson app.",
                file=sys.stderr,
            )

    store = Store(settings.db_file)
    raw_log = RawLog(settings.raw_dir)
    try:
        raw_log.write(
            {
                "at": utc_stamp(),
                "event": "session",
                "serial": device.serial,
                "name": device.name,
                "product_type": device.product_type,
                "topic_root": topic_root,
                "firmware": device.firmware_version,
                "new_version_available": device.new_version_available,
                "route": "cloud" if target.cloud else "local",
                "host": target.host,
                "port": target.port,
                "found_by": how,
                "interval": interval,
            }
        )
        listener = Listener(
            target,
            pipeline=Pipeline(store),
            raw_log=raw_log,
            on_reading=on_reading,
            on_note=lambda text: print(text, file=sys.stderr),
            poll_seconds=interval,
        )
        stats = listener.run(duration=args.duration)
    finally:
        store.close()
        raw_log.close()
    print_summary(stats, settings.db_file, raw_log.path)
    return 0


def local_target(
    args: argparse.Namespace, settings: Settings, device: Device, topic_root: str
) -> tuple[Target, str]:
    """The purifier's own broker on the home network, with its decrypted password."""
    if not device.local_credential:
        raise CliError(f"{device.serial} has no local MQTT credential in the manifest")
    try:
        password = decrypt_local_credential(device.local_credential)
    except CredentialError as exc:
        raise CliError(f"The local credential for {device.serial} didn't decrypt: {exc}") from None
    host, port, how = resolve_host(args, settings, device)
    return Target(host=host, port=port, serial=device.serial, password=password, topic_root=topic_root), how


def cloud_target(settings: Settings, device: Device, topic_root: str) -> tuple[Target, str]:
    """Dyson's AWS IoT broker, with credentials fetched fresh for this run."""
    saved = load_auth(settings)
    try:
        with make_api(settings, token=_token(saved)) as api:
            auth = CloudAuth.from_response(api.iot_credentials(device.serial))
    except AuthError:
        raise token_rejected(saved) from None
    target = Target(
        host=auth.endpoint,
        port=CLOUD_PORT,
        serial=device.serial,
        password="",
        topic_root=topic_root,
        cloud=auth,
        tls=CLOUD_TLS,
    )
    return target, "IoT credentials from Dyson"


def listen_devices(settings: Settings, *, offline: bool) -> list[Device]:
    """Refresh the device list from the cloud when possible, otherwise use the cache.

    Refreshing logs the current firmware version each run; the cache keeps
    local listening working when the cloud or the token isn't available.
    """
    saved = None if offline else read_private_json(settings.auth_file)
    if saved and _token(saved):
        try:
            manifest = refresh_manifest(settings, saved)
        except (CliError, ApiError) as exc:
            print(f"warning: couldn't refresh the device list ({exc}); using the cached copy", file=sys.stderr)
        else:
            for note in manifest.notes:
                print(f"note: {note}", file=sys.stderr)
            return manifest.devices
    cached = read_private_json(settings.devices_file)
    if not cached or not cached.get("devices"):
        raise CliError("No saved device list; run `hushjet login`, then `hushjet devices`")
    return [Device.from_cache(entry) for entry in cached["devices"]]


def resolve_host(args: argparse.Namespace, settings: Settings, device: Device) -> tuple[str, int, str]:
    port = args.port or settings.port
    if args.host:
        return args.host, port, "--host"
    if settings.host:
        return settings.host, port, "DYSON_HOST"
    hit = safe_discover(5.0, want_serial=device.serial).get(device.serial.upper())
    if hit:
        remember_host(settings, hit)
        return hit.host, args.port or hit.port, "mDNS"
    last = recall_host(settings, device.serial)
    if last:
        seen = age(last.get("seen_at"))
        return str(last["host"]), args.port or int(last.get("port") or port), f"mDNS address from {seen} ago"
    raise CliError(
        f"mDNS didn't find {device.serial}. Set DYSON_HOST to its IP in .env "
        "(a DHCP reservation keeps it fixed) or pass --host."
    )


def print_summary(stats: ListenStats, db_file: Path, raw_file: Path | None) -> None:
    counts = ", ".join(f"{name} {count}" for name, count in stats.messages.most_common()) or "none"
    print(
        f"\nStopped after {format_seconds(stats.seconds)}. "
        f"Connected {stats.connects} time(s), dropped {stats.drops} time(s)."
    )
    print(f"Sent {stats.requests} requests and received {sum(stats.messages.values())} messages: {counts}.")
    print(f"Wrote {stats.rows} rows to {db_file}. Raw log: {raw_file or 'none'}")


# --- show and replay -------------------------------------------------------------------


def cmd_show(args: argparse.Namespace, settings: Settings) -> int:
    if not settings.db_file.exists():
        raise CliError(f"No readings yet ({settings.db_file} doesn't exist); run `hushjet listen`")
    with Store(settings.db_file) as store:
        readings = store.latest(args.last)
        total = store.count()
    printer = TablePrinter()
    for reading in readings:
        printer.row(reading)
    print(f"{len(readings)} of {total} rows from {settings.db_file}")
    return 0


def cmd_replay(args: argparse.Namespace, settings: Settings) -> int:
    missing = [str(path) for path in args.files if not path.is_file()]
    if missing:
        raise CliError(f"No such file: {', '.join(missing)}")
    db_file = args.db or settings.data_dir / "replay.db"
    with Store(db_file) as store:
        existing = store.count()
        if existing and not args.append:
            raise CliError(f"{db_file} already has {existing} rows; pass --append or another --db")
        readings = replay(args.files, Pipeline(store))
    print(f"Replayed {len(readings)} readings from {len(args.files)} file(s) into {db_file}")
    return 0


# --- helpers ---------------------------------------------------------------------------


def load_auth(settings: Settings) -> dict[str, Any]:
    saved = read_private_json(settings.auth_file)
    if not saved or not _token(saved):
        raise CliError("Not logged in yet; run `hushjet login`")
    return dict(saved)


def _token(saved: Mapping[str, Any]) -> str | None:
    response = saved.get("response")
    return response.get("token") if isinstance(response, Mapping) else None


def token_rejected(saved: Mapping[str, Any]) -> CliError:
    return CliError(
        f"Dyson rejected the saved token, which was {age(saved.get('saved_at'))} old. "
        "Run `hushjet login --force`."
    )


def refresh_manifest(settings: Settings, saved: Mapping[str, Any]) -> Manifest:
    try:
        with make_api(settings, token=_token(saved)) as api:
            manifest = fetch_manifest(api)
    except AuthError:
        raise token_rejected(saved) from None
    write_private_json(
        settings.devices_file,
        {"saved_at": utc_stamp(), "devices": [device.to_cache() for device in manifest.devices]},
    )
    return manifest


def safe_discover(seconds: float, want_serial: str | None = None) -> dict[str, Found]:
    try:
        return discover(timeout=seconds, want_serial=want_serial)
    except Exception as exc:  # zeroconf raises OSError and several of its own errors.
        print(f"warning: mDNS discovery failed ({exc})", file=sys.stderr)
        return {}


def remember_host(settings: Settings, hit: Found) -> None:
    hosts = read_private_json(settings.hosts_file) or {}
    hosts[hit.serial.upper()] = {"host": hit.host, "port": hit.port, "seen_at": utc_stamp()}
    write_private_json(settings.hosts_file, hosts)


def recall_host(settings: Settings, serial: str) -> dict[str, Any] | None:
    hosts = read_private_json(settings.hosts_file) or {}
    entry = hosts.get(serial.upper())
    return entry if isinstance(entry, dict) and entry.get("host") else None


def age(stamp: Any) -> str:
    try:
        then = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return "an unknown time"
    if then.tzinfo is None:
        then = then.replace(tzinfo=timezone.utc)
    return format_seconds((datetime.now(timezone.utc) - then).total_seconds())


def format_seconds(seconds: float) -> str:
    seconds = max(0, int(seconds))
    days, rest = divmod(seconds, 86400)
    hours, rest = divmod(rest, 3600)
    minutes, secs = divmod(rest, 60)
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes:02d}m"
    if minutes:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


def parse_duration(text: str) -> float:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([smh]?)\s*", text.lower())
    if not match:
        raise argparse.ArgumentTypeError(f"not a duration: {text!r} (try 90, 15m or 1h)")
    seconds = float(match.group(1)) * {"": 1, "s": 1, "m": 60, "h": 3600}[match.group(2)]
    if seconds <= 0:
        raise argparse.ArgumentTypeError("the duration must be more than zero")
    return seconds


def positive_float(text: str) -> float:
    try:
        value = float(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a number: {text!r}") from None
    if value <= 0:
        raise argparse.ArgumentTypeError("must be more than zero")
    return value

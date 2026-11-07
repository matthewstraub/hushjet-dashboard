"""Settings from the environment (and .env), plus owner-only files for secrets."""

from __future__ import annotations

import contextlib
import json
import logging
import os
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

log = logging.getLogger(__name__)

API_HOST = "https://appapi.cp.dyson.com"
API_HOST_CN = "https://appapi.cp.dyson.cn"
DEFAULT_USER_AGENT = "android client"
DEFAULT_POLL_SECONDS = 30.0
DEFAULT_MQTT_PORT = 1883


class ConfigError(ValueError):
    """A setting is missing or malformed."""


@dataclass(frozen=True)
class Settings:
    email: str | None = None
    password: str | None = None
    country: str = "US"
    culture: str = "en-US"
    user_agent: str = DEFAULT_USER_AGENT
    host: str | None = None
    port: int = DEFAULT_MQTT_PORT
    serial: str | None = None
    poll_seconds: float = DEFAULT_POLL_SECONDS
    state_dir: Path = Path("~/.config/hushjet").expanduser()
    data_dir: Path = Path("data")

    @property
    def api_base(self) -> str:
        return API_HOST_CN if self.country == "CN" else API_HOST

    @property
    def auth_file(self) -> Path:
        return self.state_dir / "auth.json"

    @property
    def devices_file(self) -> Path:
        return self.state_dir / "devices.json"

    @property
    def hosts_file(self) -> Path:
        return self.state_dir / "hosts.json"

    @property
    def db_file(self) -> Path:
        return self.data_dir / "hushjet.db"

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        def get(name: str) -> str | None:
            value = env.get(name, "").strip()
            return value or None

        country = (get("DYSON_COUNTRY") or "US").upper()
        if len(country) != 2 or not country.isalpha():
            raise ConfigError(f"DYSON_COUNTRY must be a two-letter code like US, not {country!r}")
        return cls(
            email=get("DYSON_EMAIL"),
            # Passwords can legitimately start or end with spaces, so no strip.
            password=env.get("DYSON_PASSWORD") or None,
            country=country,
            culture=get("DYSON_CULTURE") or "en-US",
            user_agent=get("DYSON_USER_AGENT") or DEFAULT_USER_AGENT,
            host=get("DYSON_HOST"),
            port=_number(get("DYSON_PORT"), "DYSON_PORT", int, DEFAULT_MQTT_PORT),
            serial=get("DYSON_SERIAL"),
            poll_seconds=_number(
                get("DYSON_POLL_SECONDS"), "DYSON_POLL_SECONDS", float, DEFAULT_POLL_SECONDS
            ),
            state_dir=Path(get("HUSHJET_STATE_DIR") or "~/.config/hushjet").expanduser(),
            data_dir=Path(get("HUSHJET_DATA_DIR") or "data").expanduser(),
        )


def _number(value: str | None, name: str, kind: type, default: Any) -> Any:
    if value is None:
        return default
    try:
        number = kind(value)
    except ValueError:
        raise ConfigError(f"{name} must be a number, not {value!r}") from None
    if number <= 0:
        raise ConfigError(f"{name} must be greater than zero")
    return number


def write_private_json(path: Path, data: Any) -> None:
    """Write JSON that only the current user can read (0600), atomically."""
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
            fh.write("\n")
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)
        raise


def read_private_json(path: Path) -> Any | None:
    """Read a file written by write_private_json, tightening loose permissions."""
    try:
        mode = stat.S_IMODE(path.stat().st_mode)
    except FileNotFoundError:
        return None
    if mode & 0o077:
        os.chmod(path, 0o600)
        log.warning("%s was readable by other users; set it to owner-only", path)
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)

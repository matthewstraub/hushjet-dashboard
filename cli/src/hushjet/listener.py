"""Connect to the purifier's MQTT broker, ask for data, and record what comes back.

The broker is either the purifier's own, on the home network, or Dyson's AWS
IoT broker, reached over TLS websockets (see cloud.py). The messages are the
same on both. The purifier only sends sensor data when asked, so this
requests it every poll interval (30 seconds by default, like the app and Home
Assistant). State arrives once on request and then as STATE-CHANGE messages
when something changes; it is re-requested every few polls as a safety net,
since slow changes like filter life may never produce a change message.
"""

from __future__ import annotations

import json
import logging
import queue
import secrets
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

import certifi
import paho.mqtt.client as mqtt

from .cloud import WEBSOCKET_PATH, CloudAuth
from .messages import REQUEST_SENSOR_DATA, REQUEST_STATE, Reading
from .store import Pipeline, RawLog

log = logging.getLogger(__name__)

# libdyson-neon connects with MQTT 3.1, which Dyson purifiers accept.
PROTOCOL = mqtt.MQTTv31
# AWS IoT takes MQTT 3.1.1, as hass-dyson and opendyson use.
CLOUD_PROTOCOL = mqtt.MQTTv311
# CONNACK refusals that retrying won't fix.
AUTH_REFUSALS = {134, 135}  # "Bad user name or password", "Not authorized"
PROTOCOL_REFUSED = 132  # "Unsupported protocol version"


def utc_stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def command_time() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class ListenError(Exception):
    """The purifier couldn't be reached or refused the connection."""


class BadCredentials(ListenError):
    """The purifier refused the serial and password."""


@dataclass(frozen=True)
class Target:
    host: str
    port: int
    serial: str
    password: str = field(repr=False)  # The local broker's; unused for the cloud.
    topic_root: str
    cloud: CloudAuth | None = None  # Set to connect to Dyson's AWS IoT broker instead.
    tls: bool = False

    @property
    def where(self) -> str:
        return f"Dyson's cloud at {self.host}" if self.cloud else f"{self.host}:{self.port}"

    @property
    def status_topic(self) -> str:
        return f"{self.topic_root}/{self.serial}/status/current"

    @property
    def command_topic(self) -> str:
        return f"{self.topic_root}/{self.serial}/command"


@dataclass
class ListenStats:
    seconds: float = 0.0
    connects: int = 0
    drops: int = 0
    requests: int = 0
    rows: int = 0
    messages: Counter[str] = field(default_factory=Counter)


class Listener:
    def __init__(
        self,
        target: Target,
        *,
        pipeline: Pipeline,
        raw_log: RawLog,
        on_reading: Callable[[Reading], None] | None = None,
        on_note: Callable[[str], None] | None = None,
        poll_seconds: float = 30.0,
        state_every: int = 10,
        keepalive: int = 60,
        reconnect_delay: tuple[int, int] = (1, 30),
    ) -> None:
        self.target = target
        self.pipeline = pipeline
        self.raw_log = raw_log
        self.on_reading = on_reading or (lambda reading: None)
        self.on_note = on_note or log.info
        self.poll_seconds = poll_seconds
        self.state_every = state_every
        self.keepalive = keepalive
        self.reconnect_delay = reconnect_delay
        self.stats = ListenStats()
        self._events: queue.Queue[tuple[Any, ...]] = queue.Queue()

    def run(self, duration: float | None = None) -> ListenStats:
        """Listen until Ctrl-C or until `duration` seconds pass."""
        client = self._client()
        start = time.monotonic()
        try:
            client.connect(self.target.host, self.target.port, keepalive=self.keepalive)
        except OSError as exc:
            raise ListenError(self._unreachable(exc)) from exc
        client.loop_start()
        try:
            self._loop(client, None if duration is None else start + duration)
        except KeyboardInterrupt:
            pass
        finally:
            client.disconnect()
            client.loop_stop()
            self._drain()
            self.stats.seconds = time.monotonic() - start
        return self.stats

    def _unreachable(self, exc: OSError) -> str:
        if self.target.cloud and isinstance(exc, mqtt.WebsocketConnectionError):
            return (
                f"Dyson's cloud at {self.target.host} turned down the connection ({exc}). The "
                "IoT credentials may have expired; run the command again to get new ones."
            )
        if self.target.cloud:
            return (
                f"Couldn't reach Dyson's cloud at {self.target.host}:{self.target.port} ({exc}). "
                "Check this machine's internet connection."
            )
        return (
            f"Couldn't reach {self.target.host}:{self.target.port} ({exc}). Check the address "
            "and that this machine is on the purifier's network."
        )

    def _loop(self, client: mqtt.Client, deadline: float | None) -> None:
        connected = subscribed = False
        retrying = False  # Say once that connecting failed, not on every paho retry.
        reconnect_noted = False
        next_poll = 0.0
        polls = 0
        while deadline is None or time.monotonic() < deadline:
            now = time.monotonic()
            wait = 1.0
            if subscribed:
                wait = min(wait, max(0.0, next_poll - now))
            if deadline is not None:
                wait = min(wait, max(0.0, deadline - now))
            try:
                event = self._events.get(timeout=wait)
            except queue.Empty:
                event = None

            if event is None:
                pass
            elif event[0] == "message":
                self._record(*event[1:])
            elif event[0] == "connected":
                connected, retrying, reconnect_noted = True, False, False
                self.stats.connects += 1
                self._event("connected", host=self.target.host, port=self.target.port)
                self.on_note(f"Connected to {self.target.where}")
            elif event[0] == "subscribed":
                if event[1]:
                    raise ListenError(
                        f"The broker refused the subscription to {self.target.status_topic} "
                        f"({', '.join(event[1])})"
                    )
                subscribed = True
                polls = 0
                self._request(client, REQUEST_STATE)
                self._request(client, REQUEST_SENSOR_DATA)
                next_poll = time.monotonic() + self.poll_seconds
            elif event[0] == "refused":
                _, reason, code = event
                self._event("refused", reason=reason)
                if code in AUTH_REFUSALS and self.target.cloud:
                    raise BadCredentials(
                        f"Dyson's cloud refused the IoT credentials ({reason}). Run the command "
                        "again for new ones; if that keeps failing, run `hushjet login --force`."
                    )
                if code in AUTH_REFUSALS:
                    raise BadCredentials(
                        f"The purifier refused the serial and password ({reason}). "
                        "Run `hushjet devices` to refresh the credential."
                    )
                broker = "Dyson's cloud" if self.target.cloud else "The purifier"
                if code == PROTOCOL_REFUSED:
                    version = "3.1.1" if self.target.cloud else "3.1"
                    raise ListenError(f"{broker} doesn't accept MQTT {version} ({reason})")
                if not retrying:
                    self.on_note(f"{broker} refused the connection ({reason}); retrying")
                retrying = True
            elif event[0] == "reconnect_failed":
                # paho keeps retrying in the background; say so once per outage.
                if not reconnect_noted:
                    reconnect_noted = True
                    self._event("reconnect_failed")
                    hint = (
                        "; if it keeps failing, the IoT credentials may have expired, so restart "
                        "`hushjet listen --cloud`"
                        if self.target.cloud
                        else ""
                    )
                    self.on_note(f"Couldn't reconnect to {self.target.where} yet; still trying{hint}")
            elif event[0] == "disconnected":
                if connected:
                    self.stats.drops += 1
                    self._event("disconnected", reason=event[1])
                    self.on_note(f"Connection dropped ({event[1]}); reconnecting")
                elif not retrying:
                    self._event("connect_failed", reason=event[1])
                    self.on_note(
                        f"The purifier closed the connection before accepting it ({event[1]}); retrying"
                    )
                connected = subscribed = False
                retrying = True

            if subscribed and time.monotonic() >= next_poll:
                polls += 1
                if self.state_every and polls % self.state_every == 0:
                    self._request(client, REQUEST_STATE)
                self._request(client, REQUEST_SENSOR_DATA)
                next_poll += self.poll_seconds
                if next_poll <= time.monotonic():  # Fell behind, e.g. the laptop slept.
                    next_poll = time.monotonic() + self.poll_seconds

    def _drain(self) -> None:
        """Keep any messages that arrived while shutting down."""
        while True:
            try:
                event = self._events.get_nowait()
            except queue.Empty:
                return
            if event[0] == "message":
                self._record(*event[1:])

    def _record(self, topic: str, body: bytes, received_at: str) -> None:
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            text = body.decode("utf-8", "replace")
            self.raw_log.write({"at": received_at, "dir": "in", "topic": topic, "payload_text": text})
            self.stats.messages["(not JSON)"] += 1
            return
        self.raw_log.write({"at": received_at, "dir": "in", "topic": topic, "payload": payload})
        msg = payload.get("msg") if isinstance(payload, dict) else None
        self.stats.messages[str(msg)] += 1
        reading = self.pipeline.handle(topic, payload, received_at)
        if reading is not None:
            self.stats.rows += 1
            self.on_reading(reading)

    def _request(self, client: mqtt.Client, msg: str) -> None:
        payload = {"msg": msg, "time": command_time()}
        client.publish(self.target.command_topic, json.dumps(payload))
        self.stats.requests += 1
        self.raw_log.write(
            {"at": utc_stamp(), "dir": "out", "topic": self.target.command_topic, "payload": payload}
        )

    def _event(self, name: str, **details: Any) -> None:
        self.raw_log.write({"at": utc_stamp(), "event": name, **details})

    def _client(self) -> mqtt.Client:
        cloud = self.target.cloud
        if cloud is None:
            client = mqtt.Client(
                mqtt.CallbackAPIVersion.VERSION2,
                client_id=f"hushjet-{secrets.token_hex(4)}",
                protocol=PROTOCOL,
            )
            client.username_pw_set(self.target.serial, self.target.password)
        else:
            # AWS IoT only accepts the ClientId it issued, unchanged; the token goes in
            # the websocket handshake rather than as an MQTT username and password.
            client = mqtt.Client(
                mqtt.CallbackAPIVersion.VERSION2,
                client_id=cloud.client_id,
                protocol=CLOUD_PROTOCOL,
                transport="websockets",
            )
            client.ws_set_options(path=WEBSOCKET_PATH, headers=cloud.headers())
        if self.target.tls:
            client.tls_set(ca_certs=certifi.where())
        client.reconnect_delay_set(*self.reconnect_delay)
        client.connect_timeout = 10.0
        client.on_connect = self._on_connect
        client.on_connect_fail = self._on_connect_fail
        client.on_subscribe = self._on_subscribe
        client.on_disconnect = self._on_disconnect
        client.on_message = self._on_message
        return client

    # paho runs these on its network thread; they only queue events for _loop.

    def _on_connect(self, client, userdata, flags, reason_code, properties) -> None:  # type: ignore[no-untyped-def]
        if reason_code.is_failure:
            self._events.put(("refused", str(reason_code), reason_code.value))
            return
        self._events.put(("connected",))
        client.subscribe(self.target.status_topic)

    def _on_connect_fail(self, client, userdata) -> None:  # type: ignore[no-untyped-def]
        self._events.put(("reconnect_failed",))

    def _on_subscribe(self, client, userdata, mid, reason_codes, properties) -> None:  # type: ignore[no-untyped-def]
        self._events.put(("subscribed", [str(rc) for rc in reason_codes if rc.is_failure]))

    def _on_disconnect(self, client, userdata, flags, reason_code, properties) -> None:  # type: ignore[no-untyped-def]
        self._events.put(("disconnected", str(reason_code)))

    def _on_message(self, client, userdata, message) -> None:  # type: ignore[no-untyped-def]
        self._events.put(("message", message.topic, bytes(message.payload), utc_stamp()))

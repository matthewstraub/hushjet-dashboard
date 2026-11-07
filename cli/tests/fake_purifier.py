"""A tiny MQTT broker that behaves like a Dyson purifier, for tests.

It speaks just enough MQTT 3.1/3.1.1 for one paho client: CONNECT with a
username and password, SUBSCRIBE, PUBLISH at QoS 0 or 1, PINGREQ and
DISCONNECT. Requests on the command topic get canned replies on the status
topic, shaped like a real HJ10's (see tests/fixtures).

With websocket=True it stands in for Dyson's AWS IoT broker instead: MQTT
inside websocket frames on /mqtt, with the token checked in the handshake
headers (as AWS's custom authorizer does) rather than in CONNECT. There is no
TLS; tests turn it off on the client side.
"""

from __future__ import annotations

import base64
import hashlib
import json
import socket
import struct
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Protocol

CONNECT, CONNACK, PUBLISH, PUBACK = 1, 2, 3, 4
SUBSCRIBE, SUBACK, PINGREQ, PINGRESP, DISCONNECT = 8, 9, 12, 13, 14
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
WS_BINARY, WS_CLOSE, WS_PING, WS_PONG = 0x2, 0x8, 0x9, 0xA

# The real HJ10's fields, with filter life lowered so tests can tell it from 100.
HJ10_STATE = {
    "auto": "OFF",
    "cflr": "0095",
    "cflt": "CARF",
    "fnsp": "0004",
    "fnst": "FAN",
    "fpwr": "ON",
    "hflr": "0097",
    "hflt": "EHEP",
    "nmdv": "0000",
    "nmod": "OFF",
    "rhtm": "ON",
    "sltm": "OFF",
}
HJ10_SENSOR = {"pm25": "0003", "pm10": "0005", "p25r": "0004", "p10r": "0006", "sltm": "OFF"}


class Stream(Protocol):
    def recv(self, size: int) -> bytes: ...
    def sendall(self, data: bytes) -> None: ...


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class FakePurifier:
    def __init__(
        self,
        *,
        serial: str,
        password: str,
        product_type: str = "897",
        drop_after_sensor_replies: int | None = None,
        refuse_with: int | None = None,
        websocket: bool = False,
        expect_headers: dict[str, str] | None = None,
    ) -> None:
        self.serial = serial
        self.password = password
        self.refuse_with = refuse_with  # A CONNACK code to answer every CONNECT with.
        self.websocket = websocket
        # Handshake headers that must match exactly, or the upgrade gets a 401.
        self.expect_headers = {k.lower(): v for k, v in (expect_headers or {}).items()}
        self.status_topic = f"{product_type}/{serial}/status/current"
        self.command_topic = f"{product_type}/{serial}/command"
        self.state = dict(HJ10_STATE)
        self.sensor = dict(HJ10_SENSOR)
        self.drop_after = drop_after_sensor_replies
        self.handshakes: list[dict[str, Any]] = []
        self.connects: list[dict[str, Any]] = []
        self.subscriptions: list[str] = []
        self.commands: list[dict[str, Any]] = []
        self._sensor_replies = 0
        self._server = socket.create_server(("127.0.0.1", 0))
        self.port: int = self._server.getsockname()[1]
        self._stop = threading.Event()
        self._conns: list[socket.socket] = []
        self._threads: list[threading.Thread] = []

    def __enter__(self) -> FakePurifier:
        self._spawn(self._accept_loop)
        return self

    def __exit__(self, *exc: object) -> None:
        self._stop.set()
        self._server.close()
        for conn in list(self._conns):
            try:
                conn.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            conn.close()
        for thread in self._threads:
            thread.join(timeout=2)

    def _spawn(self, target: Callable[..., None], *args: Any) -> None:
        thread = threading.Thread(target=target, args=args, daemon=True)
        thread.start()
        self._threads.append(thread)

    def _accept_loop(self) -> None:
        self._server.settimeout(0.1)
        while not self._stop.is_set():
            try:
                conn, _ = self._server.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            conn.settimeout(None)
            self._conns.append(conn)
            self._spawn(self._serve, conn)

    def _serve(self, conn: socket.socket) -> None:
        with conn:
            try:
                stream: Stream = conn
                if self.websocket:
                    if not self._upgrade(conn):
                        return
                    stream = _WebSocketStream(conn)
                self._serve_mqtt(stream)
            except OSError:
                return

    def _upgrade(self, conn: socket.socket) -> bool:
        """Answer the websocket handshake, checking the path and headers."""
        request = _read_until(conn, b"\r\n\r\n")
        if request is None:
            return False
        lines = request.decode("latin-1").split("\r\n")
        path = lines[0].split(" ")[1] if len(lines[0].split(" ")) > 1 else ""
        headers = {}
        for line in lines[1:]:
            name, sep, value = line.partition(":")
            if sep:
                headers[name.strip().lower()] = value.strip()
        self.handshakes.append({"path": path, "headers": headers})
        authorized = all(headers.get(name) == value for name, value in self.expect_headers.items())
        if path != "/mqtt" or not authorized:
            conn.sendall(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
            return False
        digest = hashlib.sha1((headers.get("sec-websocket-key", "") + WS_GUID).encode()).digest()
        conn.sendall(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {base64.b64encode(digest).decode()}\r\n"
                "Sec-WebSocket-Protocol: mqtt\r\n\r\n"
            ).encode()
        )
        return True

    def _serve_mqtt(self, stream: Stream) -> None:
        subscribed = False
        while not self._stop.is_set():
            packet = _read_packet(stream)
            if packet is None:
                return
            kind, flags, body = packet
            if kind == CONNECT:
                hello = _parse_connect(body)
                self.connects.append(hello)
                if self.websocket:
                    ok = True  # The token was checked in the handshake.
                else:
                    ok = hello["username"] == self.serial and hello["password"] == self.password
                # 4 is "bad user name or password", what libdyson treats as a bad credential.
                code = self.refuse_with if self.refuse_with is not None else (0 if ok else 4)
                stream.sendall(bytes([CONNACK << 4, 2, 0, code]))
                if code:
                    return
            elif kind == SUBSCRIBE:
                packet_id, topics = body[:2], _parse_subscribe(body[2:])
                self.subscriptions.extend(topics)
                subscribed = subscribed or self.status_topic in topics
                stream.sendall(bytes([SUBACK << 4, 2 + len(topics)]) + packet_id + bytes(len(topics)))
            elif kind == PUBLISH:
                qos = (flags >> 1) & 0x03
                topic, packet_id, payload = _parse_publish(body, qos)
                if qos == 1:
                    stream.sendall(bytes([PUBACK << 4, 2]) + packet_id)
                if topic != self.command_topic:
                    continue
                command = json.loads(payload)
                self.commands.append(command)
                reply = self._reply(command)
                if reply is None or not subscribed:
                    continue
                stream.sendall(_publish(self.status_topic, json.dumps(reply).encode()))
                if self.drop_after is not None and self._sensor_replies == self.drop_after:
                    self.drop_after = None
                    return  # Like a Wi-Fi blip: the socket just closes.
            elif kind == PINGREQ:
                stream.sendall(bytes([PINGRESP << 4, 0]))
            elif kind == DISCONNECT:
                return

    def _reply(self, command: dict[str, Any]) -> dict[str, Any] | None:
        msg = command.get("msg")
        if msg == "REQUEST-CURRENT-STATE":
            return {
                "channel": "6",
                "fghp": "0",
                "fqhp": "0",
                "mode-reason": "RAPP",
                "msg": "CURRENT-STATE",
                "product-state": dict(self.state),
                "rssi": "-38",
                "scheduler": {"dstv": "0001", "srsc": "0000000000000000", "tzid": "0001"},
                "state-reason": "MODE",
                "time": _now(),
            }
        if msg == "REQUEST-PRODUCT-ENVIRONMENT-CURRENT-SENSOR-DATA":
            self._sensor_replies += 1
            return {"msg": "ENVIRONMENTAL-CURRENT-SENSOR-DATA", "time": _now(), "data": dict(self.sensor)}
        return None


class _WebSocketStream:
    """A websocket connection seen as the byte stream the MQTT parser reads."""

    def __init__(self, conn: socket.socket) -> None:
        self.conn = conn
        self.buffer = bytearray()

    def recv(self, size: int) -> bytes:
        while not self.buffer:
            payload = self._read_frame()
            if payload is None:
                return b""
            self.buffer += payload
        chunk = bytes(self.buffer[:size])
        del self.buffer[:size]
        return chunk

    def sendall(self, data: bytes) -> None:
        self.conn.sendall(_ws_frame(data))

    def _read_frame(self) -> bytes | None:
        head = _read_exact(self.conn, 2)
        if head is None:
            return None
        opcode, size = head[0] & 0x0F, head[1] & 0x7F
        if size in (126, 127):
            extended = _read_exact(self.conn, 2 if size == 126 else 8)
            if extended is None:
                return None
            size = int.from_bytes(extended, "big")
        mask = _read_exact(self.conn, 4) if head[1] & 0x80 else b""
        payload = _read_exact(self.conn, size) if size else b""
        if mask is None or payload is None:
            return None
        if mask:  # Client frames are always masked.
            payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        if opcode == WS_CLOSE:
            return None
        if opcode == WS_PING:
            self.conn.sendall(_ws_frame(payload, WS_PONG))
            return b""
        return payload


def _ws_frame(payload: bytes, opcode: int = WS_BINARY) -> bytes:
    """One unmasked, final server-to-client frame."""
    size = len(payload)
    if size < 126:
        head = bytes([0x80 | opcode, size])
    elif size < 1 << 16:
        head = bytes([0x80 | opcode, 126]) + struct.pack("!H", size)
    else:
        head = bytes([0x80 | opcode, 127]) + struct.pack("!Q", size)
    return head + payload


def _read_until(conn: socket.socket, marker: bytes, limit: int = 65536) -> bytes | None:
    data = bytearray()
    while not data.endswith(marker):
        chunk = conn.recv(1)
        if not chunk or len(data) > limit:
            return None
        data += chunk
    return bytes(data)


def _read_exact(stream: Stream, size: int) -> bytes | None:
    data = b""
    while len(data) < size:
        chunk = stream.recv(size - len(data))
        if not chunk:
            return None
        data += chunk
    return data


def _read_packet(stream: Stream) -> tuple[int, int, bytes] | None:
    first = _read_exact(stream, 1)
    if first is None:
        return None
    length, multiplier = 0, 1
    while True:
        byte = _read_exact(stream, 1)
        if byte is None:
            return None
        length += (byte[0] & 0x7F) * multiplier
        if not byte[0] & 0x80:
            break
        multiplier *= 128
    body = _read_exact(stream, length) if length else b""
    if body is None:
        return None
    return first[0] >> 4, first[0] & 0x0F, body


def _read_string(data: bytes, pos: int) -> tuple[bytes, int]:
    (size,) = struct.unpack_from("!H", data, pos)
    return data[pos + 2 : pos + 2 + size], pos + 2 + size


def _parse_connect(body: bytes) -> dict[str, Any]:
    name, pos = _read_string(body, 0)
    level, flags = body[pos], body[pos + 1]
    pos += 4  # level, flags, keepalive
    client_id, pos = _read_string(body, pos)
    if flags & 0x04:  # will topic and message
        _, pos = _read_string(body, pos)
        _, pos = _read_string(body, pos)
    username = password = None
    if flags & 0x80:
        raw, pos = _read_string(body, pos)
        username = raw.decode()
    if flags & 0x40:
        raw, pos = _read_string(body, pos)
        password = raw.decode()
    return {
        "protocol": name.decode(),
        "level": level,
        "client_id": client_id.decode(),
        "username": username,
        "password": password,
    }


def _parse_subscribe(body: bytes) -> list[str]:
    topics, pos = [], 0
    while pos < len(body):
        topic, pos = _read_string(body, pos)
        pos += 1  # requested QoS
        topics.append(topic.decode())
    return topics


def _parse_publish(body: bytes, qos: int) -> tuple[str, bytes, bytes]:
    topic, pos = _read_string(body, 0)
    packet_id = b""
    if qos:
        packet_id, pos = body[pos : pos + 2], pos + 2
    return topic.decode(), packet_id, body[pos:]


def _encode_length(size: int) -> bytes:
    out = bytearray()
    while True:
        byte, size = size % 128, size // 128
        out.append(byte | (0x80 if size else 0))
        if not size:
            return bytes(out)


def _publish(topic: str, payload: bytes) -> bytes:
    name = topic.encode()
    body = struct.pack("!H", len(name)) + name + payload
    return bytes([PUBLISH << 4]) + _encode_length(len(body)) + body

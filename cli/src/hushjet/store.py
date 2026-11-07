"""SQLite for parsed readings, JSONL for every raw message, and the glue between them."""

from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import IO, Any, Iterable, Iterator, Mapping

from .messages import Reading, Snapshot, as_text, serial_from_topic

log = logging.getLogger(__name__)

SCHEMA_VERSION = 1
SCHEMA = """
CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY,
    received_at TEXT NOT NULL,   -- UTC, when the message arrived
    device_time TEXT,            -- the message's own "time" field
    serial TEXT NOT NULL,
    msg TEXT NOT NULL,           -- the message that produced this row
    power INTEGER,               -- fpwr
    fan_speed INTEGER,           -- fnsp, 1 to 10; NULL while it reports AUTO
    auto_mode INTEGER,           -- auto
    night_mode INTEGER,          -- nmod
    monitoring INTEGER,          -- rhtm, continuous monitoring
    fan_state TEXT,              -- fnst
    hepa_filter_pct INTEGER,     -- hflr
    carbon_filter_pct INTEGER,   -- cflr; NULL when it reports INV
    pm25 INTEGER,
    pm10 INTEGER,
    sensor_status TEXT,          -- OFF, INIT or FAIL when PM isn't a number
    error_code TEXT,             -- ercd
    warning_code TEXT,           -- wacd
    state_json TEXT NOT NULL,    -- every state field, known or not
    sensor_json TEXT NOT NULL    -- every sensor field, known or not
);
CREATE INDEX IF NOT EXISTS readings_by_time ON readings (serial, received_at);
"""

COLUMNS = (
    "received_at",
    "device_time",
    "serial",
    "msg",
    "power",
    "fan_speed",
    "auto_mode",
    "night_mode",
    "monitoring",
    "fan_state",
    "hepa_filter_pct",
    "carbon_filter_pct",
    "pm25",
    "pm10",
    "sensor_status",
    "error_code",
    "warning_code",
)
FLAG_COLUMNS = ("power", "auto_mode", "night_mode", "monitoring")
_ALL = (*COLUMNS, "state_json", "sensor_json")


class Store:
    """One row per state or sensor message, each a full snapshot of what's known."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._db = sqlite3.connect(path)
        # WAL lets a dashboard read the file while `listen` writes to it.
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(SCHEMA)
        self._db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        self._db.commit()

    def __enter__(self) -> Store:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def add(self, reading: Reading) -> None:
        values = [getattr(reading, name) for name in COLUMNS]
        values.append(json.dumps(reading.state, sort_keys=True))
        values.append(json.dumps(reading.sensor, sort_keys=True))
        placeholders = ", ".join("?" * len(_ALL))
        self._db.execute(f"INSERT INTO readings ({', '.join(_ALL)}) VALUES ({placeholders})", values)
        self._db.commit()

    def count(self) -> int:
        return int(self._db.execute("SELECT COUNT(*) FROM readings").fetchone()[0])

    def latest(self, limit: int = 20) -> list[Reading]:
        cursor = self._db.execute(
            f"SELECT {', '.join(_ALL)} FROM readings ORDER BY id DESC LIMIT ?", (limit,)
        )
        return [_to_reading(row) for row in reversed(cursor.fetchall())]

    def close(self) -> None:
        self._db.close()


def _to_reading(row: tuple[Any, ...]) -> Reading:
    values = dict(zip(COLUMNS, row))
    for name in FLAG_COLUMNS:
        if values[name] is not None:
            values[name] = bool(values[name])
    return Reading(**values, state=json.loads(row[-2]), sensor=json.loads(row[-1]))


class RawLog:
    """Appends every message, request and connection event to one JSONL file per UTC day.

    {"at": "...Z", "dir": "in", "topic": "897/<serial>/status/current", "payload": {...}}
    {"at": "...Z", "dir": "out", "topic": "897/<serial>/command", "payload": {...}}
    {"at": "...Z", "event": "connected", ...}
    """

    def __init__(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        self.directory = directory
        self.path: Path | None = None
        self._fh: IO[str] | None = None

    def write(self, record: Mapping[str, Any]) -> None:
        path = self.directory / f"{str(record['at'])[:10]}.jsonl"
        if self._fh is None or path != self.path:
            self.close()
            self._fh = path.open("a", encoding="utf-8")
            self.path = path
        self._fh.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
        self._fh.flush()

    def close(self) -> None:
        if self._fh is not None:
            self._fh.close()
            self._fh = None


class Pipeline:
    """Messages in, readings out: one snapshot per device, stored as it changes."""

    def __init__(self, store: Store | None = None) -> None:
        self.store = store
        self._snapshots: dict[str, Snapshot] = {}

    def handle(self, topic: str, payload: Any, received_at: str) -> Reading | None:
        if not isinstance(payload, Mapping):
            return None
        serial = serial_from_topic(topic) or "unknown"
        snapshot = self._snapshots.setdefault(serial, Snapshot())
        msg = snapshot.apply(payload)
        if msg is None:
            return None
        reading = snapshot.reading(
            received_at=received_at,
            serial=serial,
            msg=msg,
            device_time=as_text(payload.get("time")),
        )
        if self.store is not None:
            self.store.add(reading)
        return reading


def read_raw(paths: Iterable[Path]) -> Iterator[dict[str, Any]]:
    for path in paths:
        with Path(path).open(encoding="utf-8") as fh:
            for number, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    log.warning("%s:%d is not JSON; skipped", path, number)
                    continue
                if isinstance(record, dict):
                    yield record


def replay(paths: Iterable[Path], pipeline: Pipeline) -> list[Reading]:
    """Feed a raw capture back through the parser as if it were arriving live."""
    readings = []
    for record in read_raw(paths):
        if record.get("dir") != "in" or "payload" not in record:
            continue
        reading = pipeline.handle(
            str(record.get("topic", "")), record["payload"], str(record.get("at", ""))
        )
        if reading is not None:
            readings.append(reading)
    return readings

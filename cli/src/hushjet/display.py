"""A plain terminal table of readings."""

from __future__ import annotations

import sys
from datetime import datetime
from typing import TextIO

from .messages import CURRENT_STATE, SENSOR_DATA, STATE_CHANGE, Reading

COLUMNS = (
    ("time", 8),
    ("msg", 6),
    ("power", 5),
    ("speed", 5),
    ("auto", 4),
    ("night", 5),
    ("monitor", 7),
    ("pm2.5", 5),
    ("pm10", 5),
    ("hepa", 4),
    ("carbon", 6),
)
MSG_LABELS = {CURRENT_STATE: "state", STATE_CHANGE: "change", SENSOR_DATA: "sensor"}


def local_time(stamp: str) -> str:
    try:
        when = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return stamp[11:19] or "?"
    return when.astimezone().strftime("%H:%M:%S")


def _flag(value: bool | None) -> str:
    return "-" if value is None else ("on" if value else "off")


def _num(value: int | None, suffix: str = "") -> str:
    return "-" if value is None else f"{value}{suffix}"


def cells(reading: Reading) -> list[str]:
    # When PM isn't a number, show why (off, init, fail) rather than a blank.
    gap = reading.sensor_status.lower() if reading.sensor_status else "-"
    speed = "auto" if reading.fan_speed is None and reading.auto_mode else _num(reading.fan_speed)
    return [
        local_time(reading.received_at),
        MSG_LABELS.get(reading.msg, reading.msg[:6]),
        _flag(reading.power),
        speed,
        _flag(reading.auto_mode),
        _flag(reading.night_mode),
        _flag(reading.monitoring),
        gap if reading.pm25 is None else str(reading.pm25),
        gap if reading.pm10 is None else str(reading.pm10),
        _num(reading.hepa_filter_pct, "%"),
        _num(reading.carbon_filter_pct, "%"),
    ]


class TablePrinter:
    def __init__(self, out: TextIO | None = None, header_every: int = 20) -> None:
        self.out = out or sys.stdout
        self.header_every = header_every
        self._rows = 0

    def row(self, reading: Reading) -> None:
        if self._rows % self.header_every == 0:
            print(_line([name for name, _ in COLUMNS]), file=self.out)
        print(_line(cells(reading)), file=self.out, flush=True)
        self._rows += 1


def _line(values: list[str]) -> str:
    return "  ".join(value.ljust(width) for value, (_, width) in zip(values, COLUMNS)).rstrip()

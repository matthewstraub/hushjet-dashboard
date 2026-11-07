"""Turn the purifier's MQTT messages into flat readings.

Shapes, from Pure Cool payload logs and the HJ10 Home Assistant patch:

- CURRENT-STATE: {"msg", "time", "product-state": {field: "VALUE"}}
- STATE-CHANGE: {"msg", "time", "product-state": {field: ["OLD", "NEW"]}}
- ENVIRONMENTAL-CURRENT-SENSOR-DATA: {"msg", "time", "data": {field: "VALUE"}}

A real HJ10 (firmware 0897PF.00.01.004.0007) sends these product-state fields:
fpwr, auto, fnsp, fnst, nmod, nmdv, rhtm, sltm, hflr and cflr (filter life
percent), and hflt and cflt (filter types, EHEP and CARF). It sends no ercd or
wacd. Alongside product-state it sends channel, rssi, fghp, fqhp and a
scheduler block. Its sensor data is pm25, pm10, p25r, p10r and sltm.

Numbers arrive as zero padded strings ("0004"). A sensor reports OFF, INIT or
FAIL instead of a number when it isn't measuring. Every field is kept, known
or not, in the reading's state and sensor dicts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

CURRENT_STATE = "CURRENT-STATE"
STATE_CHANGE = "STATE-CHANGE"
SENSOR_DATA = "ENVIRONMENTAL-CURRENT-SENSOR-DATA"
REQUEST_STATE = "REQUEST-CURRENT-STATE"
REQUEST_SENSOR_DATA = "REQUEST-PRODUCT-ENVIRONMENT-CURRENT-SENSOR-DATA"

SENSOR_STATUSES = ("OFF", "INIT", "FAIL")


def newest(value: Any) -> Any:
    """STATE-CHANGE sends [old, new]; the other messages send the value itself."""
    if isinstance(value, list):
        return value[-1] if value else None
    return value


def as_int(value: Any) -> int | None:
    """'0004' -> 4. Anything that isn't a plain number (AUTO, INV, OFF) -> None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def as_flag(value: Any) -> bool | None:
    if isinstance(value, str):
        text = value.strip().upper()
        if text == "ON":
            return True
        if text == "OFF":
            return False
    return None


def as_text(value: Any) -> str | None:
    return None if value is None else str(value)


def serial_from_topic(topic: str) -> str | None:
    """'897/<serial>/status/current' -> '<serial>'."""
    parts = topic.split("/")
    return parts[1] if len(parts) > 2 and parts[1] else None


@dataclass(frozen=True)
class Reading:
    """Everything known about the purifier right after one message arrived."""

    received_at: str
    serial: str
    msg: str
    device_time: str | None = None
    power: bool | None = None
    fan_speed: int | None = None
    auto_mode: bool | None = None
    night_mode: bool | None = None
    monitoring: bool | None = None
    fan_state: str | None = None
    hepa_filter_pct: int | None = None
    carbon_filter_pct: int | None = None
    pm25: int | None = None
    pm10: int | None = None
    sensor_status: str | None = None
    error_code: str | None = None
    warning_code: str | None = None
    state: dict[str, Any] = field(default_factory=dict)
    sensor: dict[str, Any] = field(default_factory=dict)


class Snapshot:
    """Latest known state and sensor values for one purifier."""

    def __init__(self) -> None:
        self.state: dict[str, Any] = {}
        self.sensor: dict[str, Any] = {}

    def apply(self, payload: Mapping[str, Any]) -> str | None:
        """Fold in one message; return its type if it carried state or sensor data."""
        msg = payload.get("msg")
        if msg in (CURRENT_STATE, STATE_CHANGE):
            fields = payload.get("product-state")
            if not isinstance(fields, Mapping):
                return None
            values = {key: newest(value) for key, value in fields.items()}
            if msg == CURRENT_STATE:
                self.state = values
            else:
                self.state.update(values)
            return msg
        if msg == SENSOR_DATA:
            fields = payload.get("data")
            if not isinstance(fields, Mapping):
                return None
            self.sensor = {key: newest(value) for key, value in fields.items()}
            return msg
        return None

    def reading(
        self, *, received_at: str, serial: str, msg: str, device_time: str | None
    ) -> Reading:
        state, sensor = self.state, self.sensor
        auto_mode = as_flag(state.get("auto"))
        if auto_mode is None and str(state.get("fnsp", "")).upper() == "AUTO":
            auto_mode = True
        return Reading(
            received_at=received_at,
            serial=serial,
            msg=msg,
            device_time=device_time,
            power=as_flag(state.get("fpwr")),
            fan_speed=as_int(state.get("fnsp")),
            auto_mode=auto_mode,
            night_mode=as_flag(state.get("nmod")),
            monitoring=as_flag(state.get("rhtm")),
            fan_state=as_text(state.get("fnst")),
            hepa_filter_pct=as_int(state.get("hflr")),
            carbon_filter_pct=as_int(state.get("cflr")),
            pm25=as_int(sensor.get("pm25")),
            pm10=as_int(sensor.get("pm10")),
            sensor_status=_sensor_status(sensor),
            error_code=as_text(state.get("ercd")),
            warning_code=as_text(state.get("wacd")),
            state=dict(state),
            sensor=dict(sensor),
        )


def _sensor_status(sensor: Mapping[str, Any]) -> str | None:
    for key in ("pm25", "pm10"):
        value = sensor.get(key)
        if isinstance(value, str) and value.strip().upper() in SENSOR_STATUSES:
            return value.strip().upper()
    return None

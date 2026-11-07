"""Parsing, storage and replay, all without the device."""

import json

import pytest
from helpers import FIXTURES, SERIAL

from hushjet.messages import (
    CURRENT_STATE,
    SENSOR_DATA,
    STATE_CHANGE,
    Snapshot,
    as_int,
    serial_from_topic,
)
from hushjet.store import Pipeline, RawLog, Store, replay

TOPIC = f"897/{SERIAL}/status/current"
SYNTHETIC = FIXTURES / "synthetic_hj10_session.jsonl"


def reading_after(*payloads):
    snapshot = Snapshot()
    msg = None
    for payload in payloads:
        msg = snapshot.apply(payload)
    return snapshot.reading(received_at="2026-11-06T18:00:00.000Z", serial=SERIAL, msg=msg, device_time=None)


def state(**fields):
    return {"msg": CURRENT_STATE, "product-state": fields}


def change(**fields):
    return {"msg": STATE_CHANGE, "product-state": fields}


def sensor(**fields):
    return {"msg": SENSOR_DATA, "data": fields}


@pytest.mark.parametrize(
    ("value", "number"),
    [("0004", 4), ("0010", 10), ("0000", 0), (7, 7), ("AUTO", None), ("INV", None), ("OFF", None), (True, None), (None, None)],
)
def test_zero_padded_numbers(value, number):
    assert as_int(value) == number


def test_state_change_pairs_use_the_new_value_and_keep_other_fields():
    reading = reading_after(
        state(fpwr="ON", fnsp="0004", hflr="0097"),
        change(fnsp=["0004", "0006"]),
    )
    assert reading.fan_speed == 6
    assert reading.power is True and reading.hepa_filter_pct == 97


def test_auto_speed_reads_as_auto_mode():
    reading = reading_after(state(fpwr="ON", fnsp="AUTO"))
    assert reading.fan_speed is None and reading.auto_mode is True


@pytest.mark.parametrize("status", ["OFF", "INIT", "FAIL", "off"])
def test_sensor_status_words_are_not_numbers(status):
    reading = reading_after(sensor(pm25=status, pm10=status))
    assert reading.pm25 is None and reading.pm10 is None
    assert reading.sensor_status == status.upper()


def test_carbon_filter_inv_is_unknown():
    assert reading_after(state(cflr="INV", hflr="0090")).carbon_filter_pct is None


def test_missing_oscillation_fields_are_fine_and_unknown_fields_are_kept():
    reading = reading_after(state(fpwr="ON", zzzz="0042"), sensor(pm25="0003", p25r="0004"))
    assert "osal" not in reading.state and "osau" not in reading.state
    assert reading.state["zzzz"] == "0042" and reading.sensor["p25r"] == "0004"


def test_messages_without_data_are_ignored():
    snapshot = Snapshot()
    assert snapshot.apply({"msg": "CURRENT-FAULTS"}) is None
    assert snapshot.apply({"msg": CURRENT_STATE}) is None
    assert snapshot.apply({"msg": SENSOR_DATA, "data": "nope"}) is None


def test_serial_from_topic():
    assert serial_from_topic(TOPIC) == SERIAL
    assert serial_from_topic("garbage") is None


def test_synthetic_session_replays_into_sqlite(tmp_path):
    with Store(tmp_path / "replay.db") as store:
        readings = replay([SYNTHETIC], Pipeline(store))
        assert store.count() == len(readings) == 7
        stored = store.latest(10)

    rows = [
        (r.msg, r.power, r.fan_speed, r.auto_mode, r.monitoring, r.pm25, r.pm10, r.sensor_status)
        for r in readings
    ]
    assert rows == [
        (CURRENT_STATE, True, 4, False, True, None, None, None),
        (SENSOR_DATA, True, 4, False, True, 3, 5, None),
        (SENSOR_DATA, True, 4, False, True, 12, 15, None),
        (STATE_CHANGE, True, None, True, True, 12, 15, None),
        (SENSOR_DATA, True, None, True, True, 9, 11, None),
        (STATE_CHANGE, False, None, True, False, 9, 11, None),
        (SENSOR_DATA, False, None, True, False, None, None, "OFF"),
    ]
    assert all(r.hepa_filter_pct == 97 and r.carbon_filter_pct == 95 for r in readings)
    assert readings[1].sensor["p25r"] == "0004"
    assert stored == readings  # SQLite round trip, flags and JSON included


@pytest.mark.parametrize("capture", sorted(FIXTURES.glob("*.jsonl")), ids=lambda p: p.name)
def test_every_capture_parses(capture, tmp_path):
    """Drop a real `hushjet listen` capture into tests/fixtures and it is checked here."""
    known = (CURRENT_STATE, STATE_CHANGE, SENSOR_DATA)
    expected = 0
    for line in capture.read_text().splitlines():
        record = json.loads(line)
        payload = record.get("payload")
        if record.get("dir") == "in" and isinstance(payload, dict) and payload.get("msg") in known:
            expected += 1
    with Store(tmp_path / "replay.db") as store:
        readings = replay([capture], Pipeline(store))
        assert store.count() == len(readings) == expected
    for reading in readings:
        for value in (reading.pm25, reading.pm10, reading.hepa_filter_pct, reading.fan_speed):
            assert value is None or isinstance(value, int)


def test_raw_log_writes_one_file_per_utc_day(tmp_path):
    log = RawLog(tmp_path / "raw")
    log.write({"at": "2026-11-06T23:59:59.000Z", "event": "a"})
    log.write({"at": "2026-11-07T00:00:01.000Z", "event": "b"})
    log.close()
    files = sorted(p.name for p in (tmp_path / "raw").iterdir())
    assert files == ["2026-11-06.jsonl", "2026-11-07.jsonl"]
    assert json.loads((tmp_path / "raw" / "2026-11-07.jsonl").read_text())["event"] == "b"


REAL_CLOUD = FIXTURES / "hj10_0897PF.00.01.004.0007_cloud.jsonl"


def test_a_real_hj10_capture_reads_correctly():
    """Two minutes of a real HJ10 through Dyson's cloud, serial replaced."""
    readings = replay([REAL_CLOUD], Pipeline())
    # The state request also brought a sensor reply, so there are five sensor rows.
    assert [r.msg for r in readings] == [CURRENT_STATE] + [SENSOR_DATA] * 5
    last = readings[-1]
    assert last.serial == SERIAL
    assert (last.power, last.fan_speed, last.auto_mode, last.night_mode) == (True, 4, False, True)
    assert (last.monitoring, last.fan_state) == (True, "FAN")
    assert (last.pm25, last.pm10, last.hepa_filter_pct, last.carbon_filter_pct) == (3, 2, 100, 100)
    # The HJ10 sends no error or warning codes, and names its filter types.
    assert last.error_code is None and last.warning_code is None
    assert (last.state["hflt"], last.state["cflt"]) == ("EHEP", "CARF")
    assert (last.sensor["p25r"], last.sensor["p10r"]) == ("0003", "0003")

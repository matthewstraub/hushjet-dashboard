"""The MQTT listener against a fake purifier on localhost."""

import dataclasses
import json
import re
import socket

import pytest
from fake_purifier import FakePurifier
from helpers import IOT_RESPONSE, MQTT_PASSWORD, SERIAL

from hushjet.cloud import CloudAuth
from hushjet.listener import BadCredentials, Listener, ListenError, Target
from hushjet.messages import CURRENT_STATE, REQUEST_SENSOR_DATA, REQUEST_STATE, SENSOR_DATA
from hushjet.store import Pipeline, RawLog, Store

# The fake cloud broker runs on 127.0.0.1, so that is the endpoint the token names.
CLOUD = CloudAuth.from_response({**IOT_RESPONSE, "Endpoint": "127.0.0.1"})


def cloud_target(port, auth=CLOUD):
    return Target("127.0.0.1", port, SERIAL, "", "897", cloud=auth, tls=False)


def make_listener(tmp_path, port, password=MQTT_PASSWORD, target=None, **options):
    store = Store(tmp_path / "hushjet.db")
    raw_log = RawLog(tmp_path / "raw")
    readings = []
    listener = Listener(
        target or Target("127.0.0.1", port, SERIAL, password, "897"),
        pipeline=Pipeline(store),
        raw_log=raw_log,
        on_reading=readings.append,
        poll_seconds=0.2,
        **options,
    )
    return listener, store, raw_log, readings


def test_reads_state_and_sensor_data(tmp_path):
    with FakePurifier(serial=SERIAL, password=MQTT_PASSWORD) as fake:
        listener, store, raw_log, readings = make_listener(tmp_path, fake.port, state_every=3)
        stats = listener.run(duration=1.5)

    hello = fake.connects[0]
    assert (hello["protocol"], hello["level"]) == ("MQIsdp", 3)  # MQTT 3.1, like libdyson-neon
    assert (hello["username"], hello["password"]) == (SERIAL, MQTT_PASSWORD)
    assert fake.subscriptions == [f"897/{SERIAL}/status/current"]

    sent = [command["msg"] for command in fake.commands]
    assert sent[:2] == [REQUEST_STATE, REQUEST_SENSOR_DATA]
    assert sent.count(REQUEST_SENSOR_DATA) >= 5
    assert sent.count(REQUEST_STATE) >= 2  # re-requested every third poll here
    assert all(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", c["time"]) for c in fake.commands)

    latest = [r for r in readings if r.msg == SENSOR_DATA][-1]
    assert (latest.pm25, latest.pm10, latest.hepa_filter_pct, latest.carbon_filter_pct) == (3, 5, 97, 95)
    assert (latest.power, latest.fan_speed, latest.auto_mode, latest.monitoring) == (True, 4, False, True)
    assert (stats.connects, stats.drops) == (1, 0)
    assert store.count() == stats.rows == len(readings)

    raw_log.close()
    store.close()
    lines = [json.loads(line) for line in raw_log.path.read_text().splitlines()]
    received = {line["payload"]["msg"] for line in lines if line.get("dir") == "in"}
    assert {CURRENT_STATE, SENSOR_DATA} <= received
    assert sum(1 for line in lines if line.get("dir") == "out") == stats.requests
    assert MQTT_PASSWORD not in raw_log.path.read_text()


def test_wrong_password_stops_with_a_clear_error(tmp_path):
    with FakePurifier(serial=SERIAL, password=MQTT_PASSWORD) as fake:
        listener, *_ = make_listener(tmp_path, fake.port, password="wrong")
        with pytest.raises(BadCredentials, match="refused the serial and password"):
            listener.run(duration=5)


def test_unsupported_protocol_is_fatal(tmp_path):
    with FakePurifier(serial=SERIAL, password=MQTT_PASSWORD, refuse_with=1) as fake:
        listener, *_ = make_listener(tmp_path, fake.port)
        with pytest.raises(ListenError, match="doesn't accept MQTT 3.1"):
            listener.run(duration=5)


def test_other_refusals_retry_and_say_so_once(tmp_path):
    notes = []
    with FakePurifier(serial=SERIAL, password=MQTT_PASSWORD, refuse_with=3) as fake:
        listener, *_ = make_listener(tmp_path, fake.port, on_note=notes.append, reconnect_delay=(1, 1))
        stats = listener.run(duration=2.5)
    assert len(fake.connects) >= 2  # paho kept retrying
    assert notes == ["The purifier refused the connection (Server unavailable); retrying"]
    assert (stats.connects, stats.drops) == (0, 0)


def test_reconnects_and_asks_for_state_again_after_a_drop(tmp_path):
    with FakePurifier(serial=SERIAL, password=MQTT_PASSWORD, drop_after_sensor_replies=1) as fake:
        listener, _, _, readings = make_listener(tmp_path, fake.port, reconnect_delay=(1, 2))
        stats = listener.run(duration=3.5)
    assert (stats.connects, stats.drops) == (2, 1)
    assert [command["msg"] for command in fake.commands].count(REQUEST_STATE) >= 2
    assert sum(1 for r in readings if r.msg == SENSOR_DATA) >= 3


def test_reads_through_the_cloud_over_websockets(tmp_path):
    with FakePurifier(
        serial=SERIAL, password=MQTT_PASSWORD, websocket=True, expect_headers=CLOUD.headers()
    ) as fake:
        listener, store, raw_log, readings = make_listener(tmp_path, fake.port, target=cloud_target(fake.port))
        stats = listener.run(duration=1.0)

    handshake = fake.handshakes[0]
    assert handshake["path"] == "/mqtt"
    assert handshake["headers"]["host"] == "127.0.0.1"
    assert handshake["headers"]["token"] == CLOUD.token_value
    assert handshake["headers"]["x-amz-customauthorizer-name"] == CLOUD.authorizer_name
    assert handshake["headers"]["x-amz-customauthorizer-signature"] == CLOUD.token_signature
    hello = fake.connects[0]
    # MQTT 3.1.1, the issued ClientId unchanged, and no username or password.
    assert (hello["protocol"], hello["level"], hello["client_id"]) == ("MQTT", 4, CLOUD.client_id)
    assert hello["username"] is None and hello["password"] is None
    assert fake.subscriptions == [f"897/{SERIAL}/status/current"]
    assert [c["msg"] for c in fake.commands][:2] == [REQUEST_STATE, REQUEST_SENSOR_DATA]

    latest = [r for r in readings if r.msg == SENSOR_DATA][-1]
    assert (latest.pm25, latest.pm10, latest.hepa_filter_pct, latest.carbon_filter_pct) == (3, 5, 97, 95)
    assert (stats.connects, stats.drops) == (1, 0)
    raw_log.close()
    store.close()
    text = raw_log.path.read_text()
    assert CLOUD.token_value not in text and CLOUD.token_signature not in text


def test_a_rejected_cloud_token_is_reported(tmp_path):
    stale = dataclasses.replace(CLOUD, token_signature="c3RhbGU=")
    with FakePurifier(
        serial=SERIAL, password=MQTT_PASSWORD, websocket=True, expect_headers=CLOUD.headers()
    ) as fake:
        listener, *_ = make_listener(tmp_path, fake.port, target=cloud_target(fake.port, stale))
        with pytest.raises(ListenError, match="IoT credentials may have expired"):
            listener.run(duration=5)


def test_unreachable_host_is_reported(tmp_path):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    listener, *_ = make_listener(tmp_path, port)
    with pytest.raises(ListenError, match="Couldn't reach"):
        listener.run(duration=1)

import os
import stat

import pytest

from hushjet.config import (
    API_HOST,
    API_HOST_CN,
    ConfigError,
    Settings,
    read_private_json,
    write_private_json,
)
from hushjet.discovery import serial_from_service_name
from hushjet.redact import REDACTED, redact


def test_settings_defaults():
    settings = Settings.from_env({})
    assert settings.country == "US" and settings.culture == "en-US"
    assert settings.user_agent == "DysonLink/205298 Darwin/27.0.0" and settings.api_base == API_HOST
    assert settings.poll_seconds == 30 and settings.port == 1883


def test_settings_overrides():
    settings = Settings.from_env(
        {"DYSON_COUNTRY": "cn", "DYSON_POLL_SECONDS": "15", "DYSON_PORT": "1884", "DYSON_PASSWORD": " pw "}
    )
    assert settings.api_base == API_HOST_CN and settings.country == "CN"
    assert settings.poll_seconds == 15 and settings.port == 1884
    assert settings.password == " pw "  # passwords are not trimmed


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({"DYSON_COUNTRY": "USA"}, "two-letter"),
        ({"DYSON_POLL_SECONDS": "soon"}, "must be a number"),
        ({"DYSON_PORT": "0"}, "greater than zero"),
    ],
)
def test_bad_settings(env, message):
    with pytest.raises(ConfigError, match=message):
        Settings.from_env(env)


def test_private_json_is_owner_only_and_loose_permissions_get_fixed(tmp_path):
    path = tmp_path / "state" / "secret.json"
    write_private_json(path, {"a": 1})
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700
    os.chmod(path, 0o644)
    assert read_private_json(path) == {"a": 1}
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert read_private_json(tmp_path / "missing.json") is None
    assert list(path.parent.iterdir()) == [path]  # no temp files left behind


def test_redact_hides_credentials_at_any_depth():
    entry = {
        "serialNumber": "HJ1-US-TEST000A",
        "connectedConfiguration": {
            "mqtt": {"localBrokerCredentials": "blob", "mqttRootTopicLevel": "897"}
        },
        "LocalCredentials": "blob2",
        "IoTCredentials": [{"TokenValue": "t", "ClientId": "c"}],
        "password": "",
    }
    assert redact(entry) == {
        "serialNumber": "HJ1-US-TEST000A",
        "connectedConfiguration": {
            "mqtt": {"localBrokerCredentials": REDACTED, "mqttRootTopicLevel": "897"}
        },
        "LocalCredentials": REDACTED,
        "IoTCredentials": REDACTED,
        "password": "",
    }


@pytest.mark.parametrize(
    ("name", "serial"),
    [
        ("897_HJ1-US-TEST000A._dyson_mqtt._tcp.local.", "HJ1-US-TEST000A"),
        ("HJ1-US-TEST000A._dyson_mqtt._tcp.local.", "HJ1-US-TEST000A"),
        ("._dyson_mqtt._tcp.local.", None),
    ],
)
def test_serial_from_mdns_name(name, serial):
    assert serial_from_service_name(name) == serial

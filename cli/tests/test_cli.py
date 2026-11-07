"""The commands end to end, with a fake cloud and a fake purifier."""

import argparse
import base64
import json
import stat

import pytest
from fake_purifier import FakePurifier
from helpers import (
    ACCOUNT_PASSWORD,
    EMAIL,
    FIRMWARE,
    FIXTURES,
    IOT_RESPONSE,
    MQTT_PASSWORD,
    OTP,
    SERIAL,
    TOKEN,
    FakeCloud,
    v3_entry,
)

from hushjet import cli
from hushjet.appapi import PATH_BEGIN_LOGIN, PATH_IOT_CREDENTIALS, PATH_MANIFEST
from hushjet.config import write_private_json
from hushjet.devices import Device
from hushjet.store import Pipeline, Store, replay

SYNTHETIC = FIXTURES / "synthetic_hj10_session.jsonl"


@pytest.fixture
def env(tmp_path):
    return {
        "DYSON_EMAIL": EMAIL,
        "DYSON_COUNTRY": "US",
        "HUSHJET_STATE_DIR": str(tmp_path / "state"),
        "HUSHJET_DATA_DIR": str(tmp_path / "data"),
    }


@pytest.fixture
def cloud(monkeypatch):
    fake = FakeCloud()
    monkeypatch.setattr(cli, "make_api", lambda settings, token=None: fake.api(token))
    return fake


@pytest.fixture
def answers(monkeypatch):
    """What the user types: the emailed code, and the password at the hidden prompt."""

    def set_answers(code=OTP, password=ACCOUNT_PASSWORD):
        monkeypatch.setattr("builtins.input", lambda prompt="": code)
        monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": password)

    set_answers()
    return set_answers


def mode(path):
    return stat.S_IMODE(path.stat().st_mode)


def logged_in(tmp_path, saved_at="2026-11-01T00:00:00.000Z"):
    write_private_json(
        tmp_path / "state" / "auth.json",
        {"email": EMAIL, "saved_at": saved_at, "response": {"token": TOKEN, "tokenType": "Bearer"}},
    )


def test_login_saves_the_token_owner_only_and_prints_no_secrets(env, cloud, answers, tmp_path, capsys):
    assert cli.main(["login"], env=env) == 0

    auth = tmp_path / "state" / "auth.json"
    assert mode(auth) == 0o600 and mode(auth.parent) == 0o700
    saved = json.loads(auth.read_text())
    assert saved["email"] == EMAIL and saved["response"]["token"] == TOKEN
    assert cloud.paths == [
        "/v1/provisioningservice/application/Android/version",
        "/v3/userregistration/email/userstatus",
        "/v3/userregistration/email/auth",
        "/v3/userregistration/email/verify",
    ]
    out = capsys.readouterr()
    assert TOKEN not in out.out + out.err and ACCOUNT_PASSWORD not in out.out + out.err
    assert "Login response fields: account, token, tokenType" in out.out


def test_login_reuses_a_saved_token_without_requesting_a_code(env, cloud, tmp_path, capsys):
    logged_in(tmp_path)
    assert cli.main(["login"], env=env) == 0
    assert cloud.requests == []
    assert "Already logged in" in capsys.readouterr().out


def test_login_with_a_wrong_code_saves_nothing(env, cloud, answers, tmp_path, capsys):
    answers(code="000000")
    assert cli.main(["login"], env=env) == 1
    assert not (tmp_path / "state" / "auth.json").exists()
    assert "rejected the code or the password" in capsys.readouterr().err


def test_login_explains_rate_limiting(env, cloud, answers, capsys):
    cloud.fail[PATH_BEGIN_LOGIN] = (429, None)
    assert cli.main(["login"], env=env) == 1
    assert "rate limiting" in capsys.readouterr().err


def test_devices_lists_the_hushjet_and_redacts_credentials(env, cloud, tmp_path, capsys):
    logged_in(tmp_path)
    assert cli.main(["devices", "--no-discover"], env=env) == 0

    out = capsys.readouterr().out
    assert SERIAL in out and FIRMWARE in out and "ok (v3)" in out and "[REDACTED]" in out
    blob = cloud.manifest[0]["connectedConfiguration"]["mqtt"]["localBrokerCredentials"]
    assert blob not in out and MQTT_PASSWORD not in out and TOKEN not in out
    cache = tmp_path / "state" / "devices.json"
    assert mode(cache) == 0o600
    assert json.loads(cache.read_text())["devices"][0]["topic_root"] == "897"


def test_devices_reports_the_v2_credential_fallback(env, cloud, tmp_path, capsys):
    logged_in(tmp_path)
    cloud.manifest = [v3_entry(credential=base64.b64encode(bytes(32)).decode())]
    assert cli.main(["devices", "--no-discover"], env=env) == 0
    out = capsys.readouterr().out
    assert "ok (v2)" in out and "the v2 LocalCredentials did" in out


def test_devices_explains_an_expired_token(env, cloud, tmp_path, capsys):
    logged_in(tmp_path)
    cloud.fail[PATH_MANIFEST] = (401, None)
    assert cli.main(["devices", "--no-discover"], env=env) == 1
    assert "login --force" in capsys.readouterr().err


def test_listen_offline_fills_sqlite_and_the_raw_log(env, tmp_path, capsys):
    write_private_json(
        tmp_path / "state" / "devices.json", {"devices": [Device.from_v3(v3_entry()).to_cache()]}
    )
    with FakePurifier(serial=SERIAL, password=MQTT_PASSWORD) as fake:
        args = ["listen", "--offline", "--host", "127.0.0.1", "--port", str(fake.port)]
        assert cli.main([*args, "--interval", "0.2", "--duration", "1"], env=env) == 0

    out = capsys.readouterr().out
    assert "pm2.5" in out and "sensor" in out and "dropped 0 time(s)" in out
    with Store(tmp_path / "data" / "hushjet.db") as store:
        assert store.count() >= 3
        assert store.latest(1)[0].pm25 == 3
    raw = next((tmp_path / "data" / "raw").glob("*.jsonl")).read_text()
    session = json.loads(raw.splitlines()[0])
    assert session["event"] == "session" and session["firmware"] == FIRMWARE
    assert MQTT_PASSWORD not in raw


def test_listen_cloud_fetches_iot_credentials_and_reads_over_websockets(
    env, cloud, tmp_path, capsys, monkeypatch
):
    logged_in(tmp_path)
    cloud.iot["Endpoint"] = "127.0.0.1"
    with FakePurifier(serial=SERIAL, password=MQTT_PASSWORD, websocket=True) as fake:
        monkeypatch.setattr(cli, "CLOUD_PORT", fake.port)
        monkeypatch.setattr(cli, "CLOUD_TLS", False)
        args = ["listen", "--cloud", "--interval", "0.2", "--duration", "1"]
        assert cli.main(args, env=env) == 0

    out = capsys.readouterr()
    assert "Listening through Dyson's cloud at 127.0.0.1" in out.out
    assert "pm2.5" in out.out and "dropped 0 time(s)" in out.out
    assert PATH_IOT_CREDENTIALS in cloud.paths
    assert fake.connects[0]["client_id"] == IOT_RESPONSE["IoTCredentials"]["ClientId"]
    raw = next((tmp_path / "data" / "raw").glob("*.jsonl")).read_text()
    session = json.loads(raw.splitlines()[0])
    assert (session["route"], session["host"], session["port"]) == ("cloud", "127.0.0.1", fake.port)
    secrets = [TOKEN, IOT_RESPONSE["IoTCredentials"]["TokenValue"], IOT_RESPONSE["IoTCredentials"]["TokenSignature"]]
    for secret in secrets:
        assert secret not in raw and secret not in out.out + out.err


def test_listen_cloud_refuses_local_only_options(env, capsys):
    assert cli.main(["listen", "--cloud", "--host", "192.168.1.20"], env=env) == 1
    assert "can't be combined with --offline, --host or --port" in capsys.readouterr().err


def test_listen_cloud_explains_an_expired_token(env, cloud, tmp_path, capsys):
    logged_in(tmp_path)
    cloud.fail[PATH_IOT_CREDENTIALS] = (401, None)
    assert cli.main(["listen", "--cloud"], env=env) == 1
    assert "login --force" in capsys.readouterr().err


def test_listen_without_a_device_list_says_what_to_run(env, tmp_path, capsys):
    assert cli.main(["listen", "--offline", "--host", "127.0.0.1"], env=env) == 1
    assert "hushjet devices" in capsys.readouterr().err


def test_show_prints_the_latest_rows(env, tmp_path, capsys):
    with Store(tmp_path / "data" / "hushjet.db") as store:
        replay([SYNTHETIC], Pipeline(store))
    assert cli.main(["show", "--last", "3"], env=env) == 0
    out = capsys.readouterr().out
    assert "3 of 7 rows" in out and "pm2.5" in out


def test_replay_refuses_to_mix_into_a_database_that_has_rows(env, capsys):
    assert cli.main(["replay", str(SYNTHETIC)], env=env) == 0
    assert "Replayed 7 readings" in capsys.readouterr().out
    assert cli.main(["replay", str(SYNTHETIC)], env=env) == 1
    assert "--append" in capsys.readouterr().err
    assert cli.main(["replay", str(SYNTHETIC), "--append"], env=env) == 0


@pytest.mark.parametrize(("text", "seconds"), [("90", 90), ("15m", 900), ("1h", 3600), ("0.5s", 0.5)])
def test_parse_duration(text, seconds):
    assert cli.parse_duration(text) == seconds


@pytest.mark.parametrize("text", ["soon", "0", "-5m"])
def test_parse_duration_rejects_nonsense(text):
    with pytest.raises(argparse.ArgumentTypeError):
        cli.parse_duration(text)

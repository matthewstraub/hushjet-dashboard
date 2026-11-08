"""The App API client and manifest handling, against a fake cloud."""

import base64
import dataclasses
import json

import pytest
from helpers import (
    ACCOUNT_PASSWORD,
    CHALLENGE,
    EMAIL,
    FIRMWARE,
    IOT_RESPONSE,
    MQTT_PASSWORD,
    OTP,
    SERIAL,
    TOKEN,
    FakeCloud,
    v2_entry,
    v3_entry,
)

from hushjet.appapi import (
    PATH_BEGIN_LOGIN,
    PATH_COMPLETE_LOGIN,
    PATH_IOT_CREDENTIALS,
    PATH_MANIFEST,
    PATH_PROVISION,
    PATH_USER_STATUS,
    ApiError,
    AuthError,
    RateLimited,
)
from hushjet.cloud import CloudAuth
from hushjet.credentials import decrypt_local_credential
from hushjet.devices import Device, choose_device, fetch_manifest

JUNK_CREDENTIAL = base64.b64encode(bytes(32)).decode()


def test_provisions_once_before_anything_else():
    cloud = FakeCloud()
    with cloud.api() as api:
        api.user_status(EMAIL)
        api.begin_login(EMAIL)
    assert cloud.paths == [PATH_PROVISION, PATH_USER_STATUS, PATH_BEGIN_LOGIN]


def test_login_requests_match_the_spec():
    cloud = FakeCloud()
    with cloud.api() as api:
        assert api.user_status(EMAIL)["accountStatus"] == "ACTIVE"
        challenge = api.begin_login(EMAIL)
        login = api.complete_login(
            email=EMAIL, password=ACCOUNT_PASSWORD, challenge_id=challenge, otp_code=OTP
        )
        api.token = login["token"]
        api.manifest()

    assert challenge == CHALLENGE and login["tokenType"] == "Bearer"
    for request in cloud.requests:
        assert request.headers["User-Agent"] == "DysonLink/205298 Darwin/27.0.0"
        if request.method == "POST":
            assert request.headers["Content-Type"] == "application/json"
    _, status, begin, verify, manifest = cloud.requests
    assert dict(status.url.params) == {"country": "US"}
    assert dict(begin.url.params) == dict(verify.url.params) == {"country": "US", "culture": "en-US"}
    assert json.loads(verify.content) == {
        "email": EMAIL,
        "password": ACCOUNT_PASSWORD,
        "challengeId": CHALLENGE,
        "otpCode": OTP,
    }
    assert "Authorization" not in verify.headers
    assert manifest.headers["Authorization"] == f"Bearer {TOKEN}"


@pytest.mark.parametrize(
    ("status", "error"),
    [(401, AuthError), (403, AuthError), (429, RateLimited), (415, ApiError), (500, ApiError)],
)
def test_error_statuses(status, error):
    cloud = FakeCloud(fail={PATH_MANIFEST: (status, None)})
    with cloud.api(token=TOKEN) as api, pytest.raises(error) as excinfo:
        api.manifest()
    assert excinfo.value.status == status


def test_error_details_are_redacted():
    cloud = FakeCloud(fail={PATH_COMPLETE_LOGIN: (500, {"Message": "boom", "token": "leaked"})})
    with cloud.api() as api, pytest.raises(ApiError) as excinfo:
        api.complete_login(email=EMAIL, password=ACCOUNT_PASSWORD, challenge_id=CHALLENGE, otp_code=OTP)
    assert "boom" in str(excinfo.value)
    assert "leaked" not in str(excinfo.value) and ACCOUNT_PASSWORD not in str(excinfo.value)


def test_manifest_needs_a_token():
    with FakeCloud().api() as api, pytest.raises(AuthError, match="login"):
        api.manifest()


def test_iot_credentials_request_matches_the_spec():
    cloud = FakeCloud()
    with cloud.api(token=TOKEN) as api:
        auth = CloudAuth.from_response(api.iot_credentials(SERIAL))

    request = cloud.requests[-1]
    assert (request.method, request.url.path) == ("POST", PATH_IOT_CREDENTIALS)
    assert json.loads(request.content) == {"Serial": SERIAL}
    assert request.headers["Authorization"] == f"Bearer {TOKEN}"
    assert request.headers["Content-Type"] == "application/json"
    creds = IOT_RESPONSE["IoTCredentials"]
    assert auth.endpoint == IOT_RESPONSE["Endpoint"] and auth.client_id == creds["ClientId"]
    assert auth.headers() == {
        "Host": IOT_RESPONSE["Endpoint"],
        "token": creds["TokenValue"],
        "X-Amz-CustomAuthorizer-Name": "TestAuthorizer",
        "X-Amz-CustomAuthorizer-Signature": creds["TokenSignature"],
    }


def test_iot_credentials_with_an_expired_token():
    cloud = FakeCloud()
    with cloud.api(token="stale") as api, pytest.raises(AuthError):
        api.iot_credentials(SERIAL)


@pytest.mark.parametrize(
    "endpoint", ["host.example", "wss://host.example/mqtt", "host.example:443", "https://host.example"]
)
def test_the_cloud_endpoint_becomes_a_bare_host(endpoint):
    assert CloudAuth.from_response({**IOT_RESPONSE, "Endpoint": endpoint}).endpoint == "host.example"


def test_incomplete_iot_credentials_name_what_is_missing():
    data = {"Endpoint": "host.example", "IoTCredentials": {"ClientId": "abc", "TokenKey": "token"}}
    with pytest.raises(ApiError, match="no CustomAuthorizerName, TokenValue, TokenSignature"):
        CloudAuth.from_response(data)


def test_cloud_auth_repr_hides_the_token():
    auth = CloudAuth.from_response(IOT_RESPONSE)
    creds = IOT_RESPONSE["IoTCredentials"]
    assert creds["TokenValue"] not in repr(auth) and creds["TokenSignature"] not in repr(auth)


def test_v3_entry_normalizes():
    device = Device.from_v3(v3_entry())
    assert device.serial == SERIAL and device.name == "Bedroom"
    assert (device.product_type, device.topic_root, device.model) == ("897", "897", "SP01-AB")
    assert device.variant is None and device.category == "ec"
    assert device.firmware_version == FIRMWARE and device.new_version_available is False
    assert device.capabilities == ("EnvironmentalData", "ExtendedAQ", "Scheduling", "ChangeWifi")
    assert device.is_hushjet


def test_the_model_alone_marks_a_hushjet():
    entry = v3_entry(type=None)
    del entry["connectedConfiguration"]["mqtt"]["mqttRootTopicLevel"]
    device = Device.from_v3(entry)
    assert device.product_type is None and device.topic_root is None
    assert device.is_hushjet  # from the model, SP01-AB


def test_v2_entry_normalizes():
    device = Device.from_v2(v2_entry())
    assert (device.serial, device.product_type, device.topic_root) == (SERIAL, "897", "897")
    assert device.firmware_version == FIRMWARE and device.source == "v2" and device.is_hushjet


def test_topic_root_falls_back_to_the_product_type():
    entry = v3_entry()
    del entry["connectedConfiguration"]["mqtt"]["mqttRootTopicLevel"]
    assert Device.from_v3(entry).topic_root == "897"


def test_cache_round_trip():
    device = Device.from_v3(v3_entry())
    assert Device.from_cache(json.loads(json.dumps(device.to_cache()))) == device


def test_fetch_manifest_checks_each_credential():
    with FakeCloud().api(token=TOKEN) as api:
        manifest = fetch_manifest(api)
    assert manifest.devices[0].credential_source == "v3" and manifest.notes == []


def test_fetch_manifest_falls_back_to_v2_when_v3_fails():
    cloud = FakeCloud(fail={PATH_MANIFEST: (500, None)})
    with cloud.api(token=TOKEN) as api:
        manifest = fetch_manifest(api)
    device = manifest.devices[0]
    assert device.source == device.credential_source == "v2"
    assert "v2 manifest instead" in manifest.notes[0]


def test_fetch_manifest_swaps_in_the_v2_credential_when_v3_wont_decrypt():
    cloud = FakeCloud(manifest=[v3_entry(credential=JUNK_CREDENTIAL)])
    with cloud.api(token=TOKEN) as api:
        manifest = fetch_manifest(api)
    device = manifest.devices[0]
    assert device.credential_source == "v2"
    assert decrypt_local_credential(device.local_credential) == MQTT_PASSWORD
    assert "the v2 LocalCredentials did" in manifest.notes[0]


def test_fetch_manifest_does_not_hide_an_expired_token():
    cloud = FakeCloud(fail={PATH_MANIFEST: (401, None)})
    with cloud.api(token=TOKEN) as api, pytest.raises(AuthError):
        fetch_manifest(api)


def test_choose_device():
    hushjet = Device.from_v3(v3_entry())
    pure_cool = Device.from_v3(v3_entry(serial="TP4-US-OTHER00A", type="438", model="TP04"))
    other = dataclasses.replace(pure_cool, topic_root="438")
    assert choose_device([other, hushjet]) == hushjet
    assert choose_device([other, hushjet], "tp4-us-other00a") == other
    with pytest.raises(LookupError, match="More than one"):
        choose_device([hushjet, Device.from_v3(v3_entry(serial="HJ1-US-TEST000B"))])
    with pytest.raises(LookupError, match="No HushJet"):
        choose_device([other])
    with pytest.raises(LookupError, match="No device with serial"):
        choose_device([hushjet], "NOPE")

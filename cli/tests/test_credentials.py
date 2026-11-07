import base64
import json

import pytest
from helpers import MQTT_PASSWORD, encrypt, make_credential

from hushjet.credentials import CredentialError, decrypt_local_credential


def test_decrypts_the_mqtt_password():
    assert decrypt_local_credential(make_credential()) == MQTT_PASSWORD


def test_tolerates_trailing_data_after_the_json():
    blob = make_credential(trailing=b'{"another": "object"}')
    assert decrypt_local_credential(blob) == MQTT_PASSWORD


def test_tolerates_zero_padding():
    blob = encrypt(json.dumps({"apPasswordHash": MQTT_PASSWORD}).encode(), pkcs7=False)
    assert decrypt_local_credential(blob) == MQTT_PASSWORD


@pytest.mark.parametrize(
    ("blob", "problem"),
    [
        ("not base64!", "base64"),
        (base64.b64encode(b"short").decode(), "AES blocks"),
        (base64.b64encode(bytes(32)).decode(), "JSON"),
        (encrypt(b'{"serial": "HJ1-US-TEST000A"}'), "apPasswordHash"),
    ],
)
def test_bad_credentials_raise(blob, problem):
    with pytest.raises(CredentialError, match=problem):
        decrypt_local_credential(blob)


def test_errors_never_carry_the_plaintext():
    blob = encrypt(b'{"apPasswordHash": "super-secret-value"')  # truncated JSON
    with pytest.raises(CredentialError) as excinfo:
        decrypt_local_credential(blob)
    assert "super-secret" not in str(excinfo.value)
    assert excinfo.value.__suppress_context__

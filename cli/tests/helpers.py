"""Shared test helpers: synthetic credentials and a fake Dyson cloud."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import httpx
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from hushjet.appapi import (
    PATH_BEGIN_LOGIN,
    PATH_COMPLETE_LOGIN,
    PATH_IOT_CREDENTIALS,
    PATH_MANIFEST,
    PATH_MANIFEST_V2,
    PATH_PROVISION,
    PATH_USER_STATUS,
    DysonAppAPI,
)
from hushjet.credentials import IV, KEY

FIXTURES = Path(__file__).parent / "fixtures"

# Synthetic values; none of these belong to a real account or device.
SERIAL = "HJ1-US-TEST000A"
MQTT_PASSWORD = "local-mqtt-hash-123"
EMAIL = "tester@example.com"
ACCOUNT_PASSWORD = "correct horse battery staple"
OTP = "123456"
TOKEN = "token-0123456789abcdef"
CHALLENGE = "5b2d3c0e-0000-4000-8000-000000000001"
FIRMWARE = "0897PF.00.01.003.0001"
# Shaped like libdyson-rest's IoTData: ClientId and TokenValue are UUIDs.
IOT_RESPONSE = {
    "Endpoint": "example-ats.iot.us-east-1.amazonaws.com",
    "IoTCredentials": {
        "ClientId": "c1d2e3f4-0000-4000-8000-0000000000c1",
        "CustomAuthorizerName": "TestAuthorizer",
        "TokenKey": "token",
        "TokenSignature": "dGVzdC1zaWduYXR1cmU=",
        "TokenValue": "a1b2c3d4-0000-4000-8000-0000000000aa",
    },
}


def encrypt(plaintext: bytes, *, pkcs7: bool = True) -> str:
    """Encrypt the way the App API does: AES-256-CBC, fixed key, zero IV, base64."""
    if pkcs7:
        padder = padding.PKCS7(128).padder()
        plaintext = padder.update(plaintext) + padder.finalize()
    else:
        plaintext += b"\x00" * (-len(plaintext) % 16)
    encryptor = Cipher(algorithms.AES(KEY), modes.CBC(IV)).encryptor()
    return base64.b64encode(encryptor.update(plaintext) + encryptor.finalize()).decode()


def make_credential(
    password: str = MQTT_PASSWORD, serial: str = SERIAL, trailing: bytes = b""
) -> str:
    return encrypt(json.dumps({"serial": serial, "apPasswordHash": password}).encode() + trailing)


def v3_entry(serial: str = SERIAL, credential: str | None = None, **overrides: Any) -> dict[str, Any]:
    """A /v3/manifest entry shaped like a real HJ10's (firmware 0897PF.00.01.004.0007).

    Only the serial, the credential and the firmware version are synthetic.
    """
    entry: dict[str, Any] = {
        "serialNumber": serial,
        "name": "Bedroom",
        "type": "897",
        "connectedConfiguration": {
            "mqtt": {
                "remoteBrokerType": "wss",
                "localBrokerCredentials": credential or make_credential(serial=serial),
                "mqttRootTopicLevel": "897",
            },
            "firmware": {
                "version": FIRMWARE,
                "autoUpdateEnabled": True,
                "newVersionAvailable": False,
                "capabilities": ["EnvironmentalData", "ExtendedAQ", "Scheduling", "ChangeWifi"],
                "minimumAppVersion": "6.4.25340",
            },
        },
        "variant": None,
        "model": "SP01-AB",
        "category": "ec",
        "connectionCategory": "lecAndWifi",
        "productName": "Dyson HushJet™ Purifier Compact HJ10",
        "countryCode": "US",
    }
    entry.update(overrides)
    return entry


def v2_entry(serial: str = SERIAL, credential: str | None = None) -> dict[str, Any]:
    """A /v2/provisioningservice/manifest entry, the PascalCase shape libdyson-neon reads."""
    return {
        "Serial": serial,
        "Name": "Bedroom",
        "Version": FIRMWARE,
        "LocalCredentials": credential or make_credential(serial=serial),
        "AutoUpdate": True,
        "NewVersionAvailable": False,
        "ProductType": "897",
        "ConnectionType": "wss",
    }


class FakeCloud:
    """Answers App API calls like appapi.cp.dyson.com and records every request."""

    def __init__(
        self,
        *,
        manifest: list[dict[str, Any]] | None = None,
        manifest_v2: list[dict[str, Any]] | None = None,
        fail: dict[str, tuple[int, Any]] | None = None,
    ) -> None:
        self.manifest = [v3_entry()] if manifest is None else manifest
        self.manifest_v2 = [v2_entry()] if manifest_v2 is None else manifest_v2
        self.iot: dict[str, Any] = json.loads(json.dumps(IOT_RESPONSE))
        self.fail = dict(fail or {})  # path -> (status, JSON body or None)
        self.requests: list[httpx.Request] = []

    @property
    def paths(self) -> list[str]:
        return [request.url.path for request in self.requests]

    def api(self, token: str | None = None) -> DysonAppAPI:
        return DysonAppAPI(
            "https://appapi.cp.dyson.com",
            user_agent="android client",
            country="US",
            culture="en-US",
            token=token,
            transport=httpx.MockTransport(self.handle),
        )

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path in self.fail:
            status, body = self.fail[path]
            return httpx.Response(status, json=body) if body is not None else httpx.Response(status)
        if path == PATH_PROVISION:
            return httpx.Response(200, json="5.0.21061")
        if path == PATH_USER_STATUS:
            return httpx.Response(
                200, json={"accountStatus": "ACTIVE", "authenticationMethod": "EMAIL_PWD_2FA"}
            )
        if path == PATH_BEGIN_LOGIN:
            return httpx.Response(200, json={"challengeId": CHALLENGE})
        if path == PATH_COMPLETE_LOGIN:
            body = json.loads(request.content)
            if body.get("otpCode") != OTP or body.get("password") != ACCOUNT_PASSWORD:
                return httpx.Response(400, json={"Message": "Unable to authenticate user."})
            return httpx.Response(
                200,
                json={
                    "account": "a0000000-0000-4000-8000-000000000000",
                    "token": TOKEN,
                    "tokenType": "Bearer",
                },
            )
        if path in (PATH_MANIFEST, PATH_MANIFEST_V2, PATH_IOT_CREDENTIALS):
            if request.headers.get("Authorization") != f"Bearer {TOKEN}":
                return httpx.Response(401)
        if path in (PATH_MANIFEST, PATH_MANIFEST_V2):
            return httpx.Response(200, json=self.manifest if path == PATH_MANIFEST else self.manifest_v2)
        if path == PATH_IOT_CREDENTIALS:
            serials = {entry.get("serialNumber") for entry in self.manifest}
            if json.loads(request.content).get("Serial") not in serials:
                return httpx.Response(400, json={"Message": "Unknown serial"})
            return httpx.Response(200, json=self.iot)
        return httpx.Response(404)

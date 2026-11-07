"""Thin client for the community-documented MyDyson App API.

Paths and shapes follow https://github.com/libdyson-wg/appapi (v0.0.2, marked
unstable) and what libdyson-neon and libdyson-rest send today. Only the calls
needed to reach the purifier's MQTT broker, on the home network or through
Dyson's cloud, are here.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from .redact import redact

log = logging.getLogger(__name__)

PATH_PROVISION = "/v1/provisioningservice/application/Android/version"
PATH_USER_STATUS = "/v3/userregistration/email/userstatus"
PATH_BEGIN_LOGIN = "/v3/userregistration/email/auth"
PATH_COMPLETE_LOGIN = "/v3/userregistration/email/verify"
PATH_MANIFEST = "/v3/manifest"
PATH_MANIFEST_V2 = "/v2/provisioningservice/manifest"
PATH_IOT_CREDENTIALS = "/v2/authorize/iot-credentials"


class ApiError(Exception):
    """The App API answered with an error or couldn't be reached."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class AuthError(ApiError):
    """401 or 403: the saved token (or, during login, the code or password) was rejected."""


class RateLimited(ApiError):
    """429: too many requests, usually one-time codes requested too often."""


class DysonAppAPI:
    def __init__(
        self,
        base_url: str,
        *,
        user_agent: str,
        country: str,
        culture: str,
        token: str | None = None,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 20.0,
    ) -> None:
        self.country = country
        self.culture = culture
        self.token = token
        self.provisioned = False
        self._http = httpx.Client(
            base_url=base_url,
            headers={"User-Agent": user_agent},
            timeout=timeout,
            transport=transport,
        )

    def __enter__(self) -> DysonAppAPI:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    def provision(self) -> str:
        """Step 1. The server ignores clients that haven't made this call recently."""
        response = self._send("GET", PATH_PROVISION)
        self.provisioned = True
        try:
            return str(response.json())
        except ValueError:
            return response.text.strip()

    def user_status(self, email: str) -> dict[str, Any]:
        """Step 2. Returns accountStatus (ACTIVE or UNREGISTERED) and authenticationMethod."""
        response = self._send(
            "POST", PATH_USER_STATUS, params={"country": self.country}, body={"email": email}
        )
        return _object(response)

    def begin_login(self, email: str) -> str:
        """Step 3. Dyson emails a one-time code; returns the challengeId that answers it."""
        response = self._send("POST", PATH_BEGIN_LOGIN, params=self._locale(), body={"email": email})
        challenge_id = _object(response).get("challengeId")
        if not challenge_id:
            raise ApiError("The login response had no challengeId")
        return str(challenge_id)

    def complete_login(
        self, *, email: str, password: str, challenge_id: str, otp_code: str
    ) -> dict[str, Any]:
        """Step 4. Returns account, token and tokenType (Bearer)."""
        body = {
            "email": email,
            "password": password,
            "challengeId": challenge_id,
            "otpCode": otp_code,
        }
        data = _object(self._send("POST", PATH_COMPLETE_LOGIN, params=self._locale(), body=body))
        if not data.get("token"):
            raise ApiError("The login response had no token")
        return data

    def manifest(self) -> list[dict[str, Any]]:
        """Step 5. Every device on the account, with camelCase fields."""
        return _array(self._send("GET", PATH_MANIFEST, auth=True))

    def manifest_v2(self) -> list[dict[str, Any]]:
        """The older manifest libdyson-neon still calls, with PascalCase fields."""
        return _array(self._send("GET", PATH_MANIFEST_V2, auth=True))

    def iot_credentials(self, serial: str) -> dict[str, Any]:
        """Step 6. AWS IoT credentials for reaching the device through Dyson's cloud.

        Returns Endpoint plus IoTCredentials: ClientId, CustomAuthorizerName,
        TokenKey, TokenSignature and TokenValue. cloud.CloudAuth parses it.
        """
        body = {"Serial": serial}
        return _object(self._send("POST", PATH_IOT_CREDENTIALS, body=body, auth=True))

    def _locale(self) -> dict[str, str]:
        return {"country": self.country, "culture": self.culture}

    def _send(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        body: dict[str, Any] | None = None,
        auth: bool = False,
    ) -> httpx.Response:
        if path != PATH_PROVISION and not self.provisioned:
            self.provision()
        headers: dict[str, str] = {}
        if method == "POST":
            # A missing Content-Type gets a 415.
            headers["Content-Type"] = "application/json"
        if auth:
            if not self.token:
                raise AuthError("Not logged in; run `hushjet login` first")
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            response = self._http.request(method, path, params=params, json=body, headers=headers)
        except httpx.HTTPError as exc:
            raise ApiError(f"{method} {path} failed: {exc}") from exc
        status = response.status_code
        log.debug("%s %s -> %s", method, path, status)
        if status in (401, 403):
            raise AuthError(f"{method} {path} was rejected ({status})", status)
        if status == 429:
            raise RateLimited("Dyson says too many requests (429); wait before trying again", status)
        if status == 415:
            raise ApiError(f"{method} {path} returned 415; it wants Content-Type: application/json", status)
        if status >= 400:
            raise ApiError(f"{method} {path} returned {status}{_error_detail(response)}", status)
        return response


def _json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        raise ApiError(f"{response.request.url.path} did not return JSON") from None


def _object(response: httpx.Response) -> dict[str, Any]:
    data = _json(response)
    if not isinstance(data, dict):
        raise ApiError(f"{response.request.url.path} returned {type(data).__name__}, not an object")
    return data


def _array(response: httpx.Response) -> list[dict[str, Any]]:
    data = _json(response)
    if not isinstance(data, list):
        raise ApiError(f"{response.request.url.path} returned {type(data).__name__}, not a list")
    return [entry for entry in data if isinstance(entry, dict)]


def _error_detail(response: httpx.Response) -> str:
    try:
        detail = json.dumps(redact(response.json()))
    except ValueError:
        detail = response.text
    detail = detail.strip()[:200]
    return f": {detail}" if detail else ""

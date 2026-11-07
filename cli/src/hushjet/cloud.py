"""Reach the purifier through Dyson's AWS IoT broker instead of the home network.

POST /v2/authorize/iot-credentials returns an endpoint and a signed token for
an AWS IoT custom authorizer. The client connects with MQTT 3.1.1 over TLS
websockets on port 443, puts the token in the handshake headers, and uses the
ClientId it was given, unchanged. Topics and messages are the same as on the
purifier's own broker. hass-dyson and opendyson connect the same way.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping
from urllib.parse import urlsplit

from .appapi import ApiError

CLOUD_PORT = 443
WEBSOCKET_PATH = "/mqtt"


@dataclass(frozen=True)
class CloudAuth:
    endpoint: str
    client_id: str
    authorizer_name: str
    token_key: str
    token_value: str = field(repr=False)
    token_signature: str = field(repr=False)

    @classmethod
    def from_response(cls, data: Mapping[str, Any]) -> CloudAuth:
        credentials = data.get("IoTCredentials")
        if not isinstance(credentials, Mapping):
            credentials = {}
        values = {
            "Endpoint": _host(data.get("Endpoint")),
            "ClientId": credentials.get("ClientId"),
            "CustomAuthorizerName": credentials.get("CustomAuthorizerName"),
            "TokenKey": credentials.get("TokenKey"),
            "TokenValue": credentials.get("TokenValue"),
            "TokenSignature": credentials.get("TokenSignature"),
        }
        missing = [name for name, value in values.items() if not value]
        if missing:
            raise ApiError(f"The IoT credentials response has no {', '.join(missing)}")
        return cls(
            endpoint=str(values["Endpoint"]),
            client_id=str(values["ClientId"]),
            authorizer_name=str(values["CustomAuthorizerName"]),
            token_key=str(values["TokenKey"]),
            token_value=str(values["TokenValue"]),
            token_signature=str(values["TokenSignature"]),
        )

    def headers(self) -> dict[str, str]:
        """Websocket handshake headers for Dyson's custom authorizer."""
        return {
            "Host": self.endpoint,
            self.token_key: self.token_value,
            "X-Amz-CustomAuthorizer-Name": self.authorizer_name,
            "X-Amz-CustomAuthorizer-Signature": self.token_signature,
        }


def _host(endpoint: Any) -> str | None:
    """The bare host name, whether the API sends a host or a URL."""
    text = str(endpoint or "").strip()
    if "://" in text:
        text = urlsplit(text).hostname or ""
    return text.split("/")[0].split(":")[0] or None

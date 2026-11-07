"""Keep credentials out of anything printed or logged.

libdyson-neon replaces LocalCredentials with "[REDACTED]" in its debug output;
this does the same for any key that looks like a secret.
"""

from __future__ import annotations

from typing import Any

REDACTED = "[REDACTED]"
_SECRET_KEY_PARTS = ("credential", "password", "token", "secret", "signature")


def is_secret_key(key: object) -> bool:
    name = str(key).lower()
    return any(part in name for part in _SECRET_KEY_PARTS)


def redact(value: Any) -> Any:
    """Return a copy with secret-looking values replaced, at any depth."""
    if isinstance(value, dict):
        return {
            key: REDACTED if is_secret_key(key) and item not in (None, "") else redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value

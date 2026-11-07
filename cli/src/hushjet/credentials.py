"""Decrypt the local MQTT password that the App API hands out encrypted.

AES-256-CBC with the fixed key 0x01..0x20 and a zero IV, as in libpurecool,
libdyson-neon (for the v2 LocalCredentials) and libdyson-rest (for the v3
localBrokerCredentials). The plaintext is JSON whose apPasswordHash field is
the MQTT password. Errors never include any of the plaintext.
"""

from __future__ import annotations

import base64
import binascii
import json

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

KEY = bytes(range(1, 33))
IV = bytes(16)


class CredentialError(ValueError):
    """The blob didn't decrypt to the expected JSON."""


def decrypt_local_credential(blob: str) -> str:
    try:
        ciphertext = base64.b64decode(blob, validate=True)
    except (binascii.Error, ValueError):
        raise CredentialError("it is not valid base64") from None
    if not ciphertext or len(ciphertext) % 16:
        raise CredentialError(f"it is {len(ciphertext)} bytes, not whole AES blocks")
    decryptor = Cipher(algorithms.AES(KEY), modes.CBC(IV)).decryptor()
    plaintext = _unpad(decryptor.update(ciphertext) + decryptor.finalize())
    try:
        text = plaintext.decode("utf-8")
        # raw_decode tolerates trailing data, which libdyson-rest has seen on robots.
        data, _ = json.JSONDecoder().raw_decode(text.lstrip())
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise CredentialError("it did not decrypt to JSON (different key or format)") from None
    if not isinstance(data, dict) or not data.get("apPasswordHash"):
        raise CredentialError("the decrypted JSON has no apPasswordHash")
    return str(data["apPasswordHash"])


def _unpad(raw: bytes) -> bytes:
    pad = raw[-1]
    if 1 <= pad <= 16 and raw.endswith(bytes([pad]) * pad):
        return raw[:-pad]  # PKCS7
    # libdyson-rest strips trailing backspace and NUL characters instead.
    return raw.rstrip(b"\x08\x00")

"""Manifest entries from the v3 and v2 endpoints, normalized into one shape."""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from typing import Any, Mapping

from .appapi import ApiError, AuthError, DysonAppAPI
from .credentials import CredentialError, decrypt_local_credential

HUSHJET_PRODUCT_TYPE = "897"
# A real HJ10's v3 manifest gives its model as SP01-AB, not HJ10.
HUSHJET_MODEL_PREFIXES = ("SP01", "HJ10", "M4P")


@dataclass(frozen=True)
class Device:
    serial: str
    name: str | None = None
    product_type: str | None = None
    model: str | None = None
    variant: str | None = None
    category: str | None = None
    topic_root: str | None = None
    firmware_version: str | None = None
    new_version_available: bool | None = None
    auto_update: bool | None = None
    capabilities: tuple[str, ...] = ()
    local_credential: str | None = field(default=None, repr=False)
    source: str = "v3"
    credential_source: str | None = None

    @classmethod
    def from_v3(cls, raw: Mapping[str, Any]) -> Device:
        connected = _mapping(raw.get("connectedConfiguration"))
        firmware = _mapping(connected.get("firmware"))
        mqtt = _mapping(connected.get("mqtt"))
        product_type = _text(raw.get("type"))
        return cls(
            serial=_text(raw.get("serialNumber")) or "",
            name=_text(raw.get("name")),
            product_type=product_type,
            model=_text(raw.get("model")),
            variant=_text(raw.get("variant")),
            category=_text(raw.get("category")),
            topic_root=_text(mqtt.get("mqttRootTopicLevel")) or product_type,
            firmware_version=_text(firmware.get("version")),
            new_version_available=_flag(firmware.get("newVersionAvailable")),
            auto_update=_flag(firmware.get("autoUpdateEnabled")),
            capabilities=tuple(str(c) for c in firmware.get("capabilities") or ()),
            local_credential=_text(mqtt.get("localBrokerCredentials")),
            source="v3",
        )

    @classmethod
    def from_v2(cls, raw: Mapping[str, Any]) -> Device:
        product_type = _text(raw.get("ProductType"))
        return cls(
            serial=_text(raw.get("Serial")) or "",
            name=_text(raw.get("Name")),
            product_type=product_type,
            variant=_text(raw.get("variant") or raw.get("Variant")),
            topic_root=product_type,
            firmware_version=_text(raw.get("Version")),
            new_version_available=_flag(raw.get("NewVersionAvailable")),
            auto_update=_flag(raw.get("AutoUpdate")),
            local_credential=_text(raw.get("LocalCredentials")),
            source="v2",
        )

    @property
    def is_hushjet(self) -> bool:
        if HUSHJET_PRODUCT_TYPE in (self.product_type, self.topic_root):
            return True
        return (self.model or "").upper().startswith(HUSHJET_MODEL_PREFIXES)

    @property
    def label(self) -> str:
        return self.name or self.serial

    def to_cache(self) -> dict[str, Any]:
        data = dataclasses.asdict(self)
        data["capabilities"] = list(self.capabilities)
        return data

    @classmethod
    def from_cache(cls, data: Mapping[str, Any]) -> Device:
        names = {f.name for f in dataclasses.fields(cls)}
        values = {key: value for key, value in data.items() if key in names}
        values["capabilities"] = tuple(values.get("capabilities") or ())
        return cls(**values)


@dataclass
class Manifest:
    devices: list[Device]
    raw: list[dict[str, Any]]  # As returned, credentials included: redact before showing.
    notes: list[str]


def fetch_manifest(api: DysonAppAPI) -> Manifest:
    """Fetch the v3 manifest (or v2 if it fails) and check every credential decrypts.

    A v3 credential that won't decrypt is swapped for the v2 one for the same
    serial when that one does, which answers whether both use the same key.
    """
    notes: list[str] = []
    try:
        raw = api.manifest()
        devices = [Device.from_v3(entry) for entry in raw]
    except AuthError:
        raise
    except ApiError as exc:
        notes.append(f"The v3 manifest failed ({exc}); used the older v2 manifest instead")
        raw = api.manifest_v2()
        devices = [Device.from_v2(entry) for entry in raw]

    v2_by_serial: dict[str, Mapping[str, Any]] | None = None
    checked: list[Device] = []
    for device in devices:
        if not device.local_credential:
            checked.append(device)
            continue
        problem = _decrypt_problem(device.local_credential)
        if problem is None:
            checked.append(dataclasses.replace(device, credential_source=device.source))
            continue
        if device.source == "v3":
            if v2_by_serial is None:
                try:
                    v2_by_serial = {str(e.get("Serial")): e for e in api.manifest_v2()}
                except ApiError as exc:
                    v2_by_serial = {}
                    notes.append(f"Couldn't fetch the v2 manifest to compare credentials ({exc})")
            blob = _text(v2_by_serial.get(device.serial, {}).get("LocalCredentials"))
            if blob and _decrypt_problem(blob) is None:
                notes.append(
                    f"{device.serial}: the v3 localBrokerCredentials didn't decrypt ({problem}), "
                    "but the v2 LocalCredentials did; using that"
                )
                checked.append(
                    dataclasses.replace(device, local_credential=blob, credential_source="v2")
                )
                continue
        notes.append(f"{device.serial}: the local credential didn't decrypt ({problem})")
        checked.append(device)
    return Manifest(checked, raw, notes)


def choose_device(devices: list[Device], serial: str | None = None) -> Device:
    if serial:
        for device in devices:
            if device.serial.upper() == serial.upper():
                return device
        raise LookupError(f"No device with serial {serial} (found: {_serials(devices)})")
    hushjets = [device for device in devices if device.is_hushjet]
    if len(hushjets) == 1:
        return hushjets[0]
    if hushjets:
        raise LookupError(
            f"More than one HushJet ({_serials(hushjets)}); set DYSON_SERIAL or pass --serial"
        )
    raise LookupError(
        f"No HushJet (product type 897) on this account (found: {_serials(devices)}); "
        "pass --serial to use another purifier"
    )


def _decrypt_problem(blob: str) -> str | None:
    try:
        decrypt_local_credential(blob)
    except CredentialError as exc:
        return str(exc)
    return None


def _serials(devices: list[Device]) -> str:
    return ", ".join(d.serial for d in devices) or "none"


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _text(value: Any) -> str | None:
    if value is None or value == "":
        return None
    return str(value)


def _flag(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None

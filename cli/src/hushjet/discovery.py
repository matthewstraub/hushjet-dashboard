"""Find Dyson purifiers on the LAN with mDNS.

Fans and purifiers advertise _dyson_mqtt._tcp.local. with an instance name of
"<product type>_<serial>", the format libdyson-neon parses.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

SERVICE_TYPE = "_dyson_mqtt._tcp.local."


@dataclass(frozen=True)
class Found:
    serial: str
    host: str
    port: int
    service_name: str


def serial_from_service_name(name: str) -> str | None:
    """'897_XXX-XX-XXXXXXXX._dyson_mqtt._tcp.local.' -> 'XXX-XX-XXXXXXXX'."""
    instance = name.split(".", 1)[0]
    prefix, sep, serial = instance.partition("_")
    return (serial if sep else prefix) or None


def discover(timeout: float = 5.0, want_serial: str | None = None) -> dict[str, Found]:
    """Browse for `timeout` seconds, or until `want_serial` shows up.

    Returns what was found keyed by upper-case serial.
    """
    from zeroconf import IPVersion, ServiceBrowser, ServiceStateChange, Zeroconf

    want = want_serial.upper() if want_serial else None
    found: dict[str, Found] = {}
    lock = threading.Lock()
    done = threading.Event()

    # zeroconf calls handlers with these exact keyword names.
    def on_change(zeroconf, service_type, name, state_change) -> None:  # type: ignore[no-untyped-def]
        if state_change not in (ServiceStateChange.Added, ServiceStateChange.Updated):
            return
        serial = serial_from_service_name(name)
        info = zeroconf.get_service_info(service_type, name, timeout=3000)
        if info is None or not serial:
            return
        addresses = info.parsed_addresses(IPVersion.V4Only) or info.parsed_addresses()
        if not addresses:
            return
        with lock:
            found[serial.upper()] = Found(serial, addresses[0], info.port or 1883, name)
        if want and serial.upper() == want:
            done.set()

    zc = Zeroconf()
    try:
        browser = ServiceBrowser(zc, SERVICE_TYPE, handlers=[on_change])
        done.wait(timeout)
        browser.cancel()
    finally:
        zc.close()
    with lock:
        return dict(found)

"""Outbound egress policy for connection adapters (ROADMAP §5.2 SSRF guard).

Every adapter resolves its target host through :func:`enforce` BEFORE opening a
socket. A host is BLOCKED when any of its resolved addresses is loopback,
private, link-local, unique-local, multicast, reserved, unspecified, or the
cloud metadata address (169.254.169.254 / its IPv6 forms) — including
IPv4-mapped IPv6 forms. The only escape hatch is an explicit allowlist
(``EGRESS_ALLOW_HOSTS``), used for the compose-internal test servers.

This mirrors the app's ``safeFetch`` posture: deny-by-default for anything that
resolves inside the trust boundary, allow public destinations and named
exceptions.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Iterable

# The cloud metadata endpoints. 169.254.169.254 is already link-local (and thus
# blocked), but we name it explicitly so the block reason is unambiguous.
_METADATA_IPS = frozenset(
    {
        ipaddress.ip_address("169.254.169.254"),
        ipaddress.ip_address("fd00:ec2::254"),
    }
)


class EgressBlocked(Exception):
    """Raised when a target host is not permitted by the egress policy."""


def _mapped_to_v4(addr: ipaddress._BaseAddress) -> ipaddress._BaseAddress:
    """Collapse an IPv4-mapped/compatible IPv6 address to its IPv4 form."""
    if isinstance(addr, ipaddress.IPv6Address):
        mapped = addr.ipv4_mapped
        if mapped is not None:
            return mapped
        # ::ffff:a.b.c.c already covered above; also handle 6to4/sixtofour.
        if addr.sixtofour is not None:
            return addr.sixtofour
    return addr


def is_blocked_address(ip: str) -> bool:
    """True when ``ip`` falls in any disallowed range (used after resolution)."""
    addr = ipaddress.ip_address(ip)
    addr = _mapped_to_v4(addr)
    if addr in _METADATA_IPS:
        return True
    return (
        addr.is_loopback
        or addr.is_private  # covers RFC1918, unique-local fc00::/7, etc.
        or addr.is_link_local  # 169.254/16, fe80::/10
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def enforce(host: str, allow_hosts: Iterable[str] = ()) -> None:
    """Resolve ``host`` and raise :class:`EgressBlocked` if it is not permitted.

    A host on the allowlist is permitted without resolution checks (the operator
    has vouched for it — e.g. compose-internal SFTP). Otherwise every resolved
    address must be a public/global address.
    """
    allow = {h.lower() for h in allow_hosts}
    if host.lower() in allow:
        return

    # A bare IP literal short-circuits DNS but still gets range-checked.
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if is_blocked_address(str(literal)):
            raise EgressBlocked(
                f"egress to {host} is blocked (resolves to a non-public address) "
                f"and it is not in EGRESS_ALLOW_HOSTS"
            )
        return

    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise EgressBlocked(f"egress to {host} is blocked: DNS resolution failed") from exc

    if not infos:
        raise EgressBlocked(f"egress to {host} is blocked: no addresses resolved")

    for info in infos:
        sockaddr = info[4]
        ip = sockaddr[0]
        if is_blocked_address(ip):
            raise EgressBlocked(
                f"egress to {host} is blocked: it resolves to a non-public "
                f"address, and it is not in EGRESS_ALLOW_HOSTS"
            )

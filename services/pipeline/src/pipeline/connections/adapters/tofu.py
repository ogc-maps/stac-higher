"""Trust-on-first-use (TOFU) host-key pinning — pure decision function.

SSH-family connections pin the server host key on the first successful test
(ROADMAP §5.2). On every later test the freshly observed key must match the
pinned one; a mismatch is a hard failure (possible MITM / server re-key), which
the operator resolves by explicitly clearing the pin
(``/api/connections/[id]/host-key/reset``).

This module is a pure function so the policy is unit-testable without a live
SSH server. The drain/health-sweep jobs feed it the stored pin and the observed
key and act on the verdict.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class TofuVerdict(StrEnum):
    FIRST_PIN = "first-pin"  # no stored key — pin the observed one
    MATCH = "match"  # observed key equals the pin — proceed
    MISMATCH = "mismatch"  # observed key differs — hard fail


@dataclass(frozen=True)
class TofuDecision:
    verdict: TofuVerdict
    #: the key to persist as the new pin (only for FIRST_PIN); else None
    key_to_pin: str | None
    #: operator-facing message (populated on MISMATCH)
    message: str | None


def evaluate_host_key(pinned_key: str | None, observed_key: str) -> TofuDecision:
    """Decide what to do given the stored pin and the freshly observed key.

    - ``pinned_key`` is None/empty  -> FIRST_PIN (pin ``observed_key``)
    - equal                          -> MATCH
    - different                      -> MISMATCH (hard fail)

    Keys are compared verbatim (the caller supplies a stable string form, e.g.
    the base64 of the server key). Never log the raw key values.
    """
    observed = observed_key.strip()
    if not observed:
        raise ValueError("observed host key must be a non-empty string")

    if not pinned_key:
        return TofuDecision(TofuVerdict.FIRST_PIN, key_to_pin=observed, message=None)

    if pinned_key.strip() == observed:
        return TofuDecision(TofuVerdict.MATCH, key_to_pin=None, message=None)

    return TofuDecision(
        TofuVerdict.MISMATCH,
        key_to_pin=None,
        message=(
            "host key mismatch: the server presented a key different from the "
            "pinned one. Refusing to connect. If the server was legitimately "
            "re-keyed, reset the host-key pin and test again."
        ),
    )

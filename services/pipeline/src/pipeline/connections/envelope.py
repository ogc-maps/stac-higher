"""Credential envelope decrypt/seal — Python side of the cross-runtime format.

Byte-for-byte compatible with ``app/src/lib/connections/crypto.ts``:

    byte 0        version (0x01)
    bytes 1..12   96-bit nonce
    bytes 13..    AES-256-GCM ciphertext || 16-byte auth tag

Plaintext is the UTF-8 JSON of the per-protocol credential object. The key is
``CREDENTIALS_MASTER_KEY`` — base64-encoded 32 bytes. A missing or malformed key
fails loudly: there is no fallback key, ever.

``seal`` exists for round-trip/tamper tests and never runs in production (the
app is the only writer). Decryption is the only production path here.
"""

from __future__ import annotations

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENVELOPE_VERSION = 0x01
NONCE_LENGTH = 12
TAG_LENGTH = 16
KEY_LENGTH = 32


class CredentialKeyError(Exception):
    """CREDENTIALS_MASTER_KEY is missing or not a base64-encoded 32-byte key."""


class EnvelopeError(Exception):
    """The envelope is truncated, wrong version, or fails authentication."""


def load_master_key(env: dict[str, str] | None = None) -> bytes:
    """Decode + validate CREDENTIALS_MASTER_KEY. Raise loudly when unusable.

    Accepts either an explicit env mapping (tests) or ``os.environ``.
    """
    source = os.environ if env is None else env
    raw = source.get("CREDENTIALS_MASTER_KEY")
    if not raw:
        raise CredentialKeyError(
            "CREDENTIALS_MASTER_KEY is not set. The pipeline cannot decrypt "
            "connection credentials without it; configure the same base64 key "
            "the app uses."
        )
    try:
        key = base64.b64decode(raw, validate=True)
    except (ValueError, base64.binascii.Error) as exc:  # type: ignore[attr-defined]
        raise CredentialKeyError("CREDENTIALS_MASTER_KEY is not valid base64.") from exc
    if len(key) != KEY_LENGTH:
        raise CredentialKeyError(
            f"CREDENTIALS_MASTER_KEY must decode to {KEY_LENGTH} bytes (got {len(key)})."
        )
    return key


def decrypt(envelope: bytes, key: bytes) -> str:
    """Open an envelope, returning the UTF-8 plaintext.

    Raises :class:`EnvelopeError` on a truncated/wrong-version envelope or an
    authentication failure (wrong key or tampered bytes).
    """
    if len(envelope) < 1 + NONCE_LENGTH + TAG_LENGTH:
        raise EnvelopeError("Credential envelope is truncated")
    if envelope[0] != ENVELOPE_VERSION:
        raise EnvelopeError(f"Unsupported credential envelope version 0x{envelope[0]:02x}")
    nonce = envelope[1 : 1 + NONCE_LENGTH]
    # cryptography's AESGCM expects ciphertext||tag together, which is exactly
    # the on-wire layout after the nonce.
    ciphertext_and_tag = envelope[1 + NONCE_LENGTH :]
    try:
        plaintext = AESGCM(key).decrypt(nonce, ciphertext_and_tag, None)
    except InvalidTag as exc:
        raise EnvelopeError(
            "Credential envelope failed authentication (wrong key or tampered data)"
        ) from exc
    return plaintext.decode("utf-8")


def seal(plaintext: str, key: bytes, nonce: bytes | None = None) -> bytes:
    """Seal a UTF-8 plaintext into a versioned envelope.

    ``nonce`` is only for deterministic tests (the known-answer vector); in any
    real use it must be omitted so a fresh random nonce is generated.
    """
    if nonce is None:
        nonce = os.urandom(NONCE_LENGTH)
    if len(nonce) != NONCE_LENGTH:
        raise ValueError(f"nonce must be {NONCE_LENGTH} bytes")
    ciphertext_and_tag = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    return bytes([ENVELOPE_VERSION]) + nonce + ciphertext_and_tag

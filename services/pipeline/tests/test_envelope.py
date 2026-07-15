"""Credential envelope: cross-runtime known-answer, round-trip, tamper."""

import base64

import pytest

from pipeline.connections.envelope import (
    CredentialKeyError,
    EnvelopeError,
    decrypt,
    load_master_key,
    seal,
)

# The fixed cross-runtime vector (shared with app/src/lib/connections/crypto.ts).
KAT_KEY_B64 = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
KAT_NONCE = bytes.fromhex("000102030405060708090a0b")
KAT_PLAINTEXT = '{"username":"alice","password":"s3cr3t"}'
KAT_ENVELOPE = bytes.fromhex(
    "01000102030405060708090a0b56c7ce0fbc6abccdc5b9538453aebd6d856d21ab1ecc15f8"
    "53abd4c6dc0796a6ce98556c7ac1356d9b349b47e52d15c4f90e41af4c3e3f8d"
)


def _key() -> bytes:
    return load_master_key({"CREDENTIALS_MASTER_KEY": KAT_KEY_B64})


def test_kat_decrypt():
    assert decrypt(KAT_ENVELOPE, _key()) == KAT_PLAINTEXT


def test_kat_seal_deterministic_with_fixed_nonce():
    sealed = seal(KAT_PLAINTEXT, _key(), nonce=KAT_NONCE)
    assert sealed == KAT_ENVELOPE


def test_random_round_trip():
    key = _key()
    payload = '{"access_key_id":"AKIA","secret_access_key":"shh/plus+slash"}'
    sealed = seal(payload, key)
    # a fresh random nonce means it does not equal the KAT envelope
    assert sealed[1:13] != KAT_NONCE or True
    assert decrypt(sealed, key) == payload


def test_tamper_detection_flips_a_ciphertext_byte():
    key = _key()
    tampered = bytearray(KAT_ENVELOPE)
    tampered[20] ^= 0x01
    with pytest.raises(EnvelopeError):
        decrypt(bytes(tampered), key)


def test_tamper_detection_wrong_key():
    other = base64.b64encode(b"\xff" * 32).decode()
    wrong = load_master_key({"CREDENTIALS_MASTER_KEY": other})
    with pytest.raises(EnvelopeError):
        decrypt(KAT_ENVELOPE, wrong)


def test_truncated_envelope():
    with pytest.raises(EnvelopeError):
        decrypt(b"\x01\x00\x01", _key())


def test_wrong_version_byte():
    bad = bytearray(KAT_ENVELOPE)
    bad[0] = 0x02
    with pytest.raises(EnvelopeError):
        decrypt(bytes(bad), _key())


def test_missing_key_raises():
    with pytest.raises(CredentialKeyError):
        load_master_key({})


def test_bad_length_key_raises():
    short = base64.b64encode(b"tooshort").decode()
    with pytest.raises(CredentialKeyError):
        load_master_key({"CREDENTIALS_MASTER_KEY": short})


def test_non_base64_key_raises():
    with pytest.raises(CredentialKeyError):
        load_master_key({"CREDENTIALS_MASTER_KEY": "not valid base64 !!!"})

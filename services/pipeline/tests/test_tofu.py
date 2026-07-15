"""TOFU host-key decision — pure function."""

import pytest

from pipeline.connections.adapters.tofu import (
    TofuVerdict,
    evaluate_host_key,
)

KEY_A = "ssh-ed25519 AAAAKEYA"
KEY_B = "ssh-ed25519 AAAAKEYB"


def test_first_pin_when_none_stored():
    d = evaluate_host_key(None, KEY_A)
    assert d.verdict is TofuVerdict.FIRST_PIN
    assert d.key_to_pin == KEY_A
    assert d.message is None


def test_first_pin_when_empty_stored():
    d = evaluate_host_key("", KEY_A)
    assert d.verdict is TofuVerdict.FIRST_PIN
    assert d.key_to_pin == KEY_A


def test_match():
    d = evaluate_host_key(KEY_A, KEY_A)
    assert d.verdict is TofuVerdict.MATCH
    assert d.key_to_pin is None
    assert d.message is None


def test_match_ignores_surrounding_whitespace():
    d = evaluate_host_key(KEY_A, f"  {KEY_A}  ")
    assert d.verdict is TofuVerdict.MATCH


def test_mismatch_is_hard_fail():
    d = evaluate_host_key(KEY_A, KEY_B)
    assert d.verdict is TofuVerdict.MISMATCH
    assert d.key_to_pin is None
    assert d.message and "mismatch" in d.message.lower()


def test_empty_observed_key_rejected():
    with pytest.raises(ValueError):
        evaluate_host_key(KEY_A, "   ")

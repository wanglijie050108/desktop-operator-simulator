from __future__ import annotations

import pytest

from desktop_agent.observation_text import (
    repair_surrogates,
    sanitize_observation_text,
    strip_private_and_control,
)


def test_repair_joins_a_valid_surrogate_pair() -> None:
    # A correctly paired surrogate sequence denotes one astral character.
    paired = "\ud83d\ude00"  # 😀 written as a UTF-16 surrogate pair
    repaired = repair_surrogates(paired)
    assert repaired == "\U0001f600"
    assert repaired.encode("utf-8")  # strict UTF-8 encoding must not raise


def test_repair_replaces_lone_surrogates() -> None:
    # A truncated emoji: high surrogate with no low surrogate following it.
    assert repair_surrogates("\ud83d") == "\ufffd"
    # A stray low surrogate on its own.
    assert repair_surrogates("\ude00") == "\ufffd"
    # A high surrogate followed by a normal character is still lone.
    assert repair_surrogates("\ud83dabc") == "\ufffdabc"


def test_repair_is_a_no_op_without_surrogates() -> None:
    value = "普通文本 with emoji 😀 and punctuation，。"
    assert repair_surrogates(value) == value


def test_repair_handles_trailing_high_surrogate() -> None:
    assert repair_surrogates("title\ud83d") == "title\ufffd"


def test_strip_removes_private_use_and_control_characters() -> None:
    # Private use (VS Code navigation items), a bidi override, and a NUL byte.
    value = "a\ue000b\u202ec\x00d\U000f0000e"
    assert strip_private_and_control(value) == "abcde"


def test_strip_keeps_tabs_and_newlines() -> None:
    assert strip_private_and_control("a\tb\nc") == "a\tb\nc"


def test_sanitize_applies_length_cap_after_repair() -> None:
    assert sanitize_observation_text("abcdef", maximum_length=3) == "abc"


def test_sanitize_never_leaves_an_unencodable_string() -> None:
    # A lone surrogate inside text that also gets truncated must still encode.
    result = sanitize_observation_text("ab\ud83dcd", maximum_length=10)
    assert result.encode("utf-8")
    assert result == "ab\ufffdcd"


def test_sanitize_rejects_a_non_positive_length() -> None:
    with pytest.raises(ValueError):
        sanitize_observation_text("a", maximum_length=0)


def test_sanitize_strips_then_truncates() -> None:
    # The private-use character is removed before the length cap is applied, so the cap
    # counts only characters that will actually be serialized.
    assert sanitize_observation_text("a\ue000bc", maximum_length=3) == "abc"

"""Character-level hygiene for observation text before it leaves the Agent.

UI Automation hands back strings that are not safe to serialize as-is:

- Emoji and other non-BMP characters may arrive as *lone* UTF-16 surrogates. Strict
  UTF-8 encoders (and therefore the WebSocket JSON envelope, and the Control Server's
  ``JSON.parse``) reject the whole message, so one emoji in one window title can take
  down an entire observation.
- Some applications (VS Code is the documented case) embed Unicode Private Use Area
  characters in the ``Name`` property. They render as tofu boxes in a model prompt and
  carry no usable meaning.
- Control characters and bidirectional overrides can hide or reorder text, which is a
  cheap way to smuggle instructions past a reader.

This module is deliberately pure and Windows-free so it is unit-testable on any host.
Redaction (replacing labels with HMAC tokens) is a separate, Control Server concern;
this module only guarantees the surrounding bytes are well-formed.
"""

from __future__ import annotations

import unicodedata

_SURROGATE_LOW_START = 0xDC00
_SURROGATE_LOW_END = 0xDFFF
_SURROGATE_HIGH_START = 0xD800
_SURROGATE_HIGH_END = 0xDBFF
# Unicode replacement character, used where a lone surrogate cannot be recovered.
_REPLACEMENT = "\ufffd"


def _is_private_use(code_point: int) -> bool:
    return (
        0xE000 <= code_point <= 0xF8FF  # BMP private use area
        or 0xF0000 <= code_point <= 0xFFFFD  # Supplementary private use area-A
        or 0x100000 <= code_point <= 0x10FFFD  # Supplementary private use area-B
    )


def _is_disallowed(code_point: int) -> bool:
    """Characters removed regardless of context.

    Tab/newline are kept because some multi-line controls use them as line breaks; the
    Control Server bounds the total length separately.
    """

    if code_point in (0x09, 0x0A):
        return False
    category = unicodedata.category(chr(code_point))
    # Cc = control, Cf = format (includes bidi overrides such as U+202E), Co = private use.
    return category in {"Cc", "Cf", "Co"} or _is_private_use(code_point)


def repair_surrogates(value: str) -> str:
    """Replace lone UTF-16 surrogates so the result always encodes as strict UTF-8.

    Windows strings are UTF-16, so Python may hold surrogate code points that were never
    part of a valid pair (a truncated emoji, for example). A correctly paired surrogate
    is folded back into its single code point; a lone one becomes U+FFFD instead of
    raising later at encode time.
    """

    if not any(_SURROGATE_HIGH_START <= ord(char) <= _SURROGATE_LOW_END for char in value):
        return value

    output: list[str] = []
    index = 0
    length = len(value)
    while index < length:
        code_point = ord(value[index])
        if _SURROGATE_HIGH_START <= code_point <= _SURROGATE_HIGH_END and index + 1 < length:
            low = ord(value[index + 1])
            if _SURROGATE_LOW_START <= low <= _SURROGATE_LOW_END:
                combined = 0x10000 + ((code_point - _SURROGATE_HIGH_START) << 10)
                output.append(chr(combined + (low - _SURROGATE_LOW_START)))
                index += 2
                continue
        if _SURROGATE_HIGH_START <= code_point <= _SURROGATE_LOW_END:
            output.append(_REPLACEMENT)
        else:
            output.append(value[index])
        index += 1
    return "".join(output)


def strip_private_and_control(value: str) -> str:
    """Drop private-use, control, and format (bidi) characters from ``value``."""

    return "".join(char for char in value if not _is_disallowed(ord(char)))


def sanitize_observation_text(value: str, *, maximum_length: int) -> str:
    """Make a UIA-sourced string safe to serialize and bounded in length.

    Order matters: surrogates are repaired first so that a truncated emoji does not
    leave an unencodable byte behind, and the length cap is applied last so truncation
    cannot cut a surrogate pair in half. Truncation never extends the value.
    """

    if maximum_length < 1:
        raise ValueError("Maximum observation text length must be positive")
    return strip_private_and_control(repair_surrogates(value))[:maximum_length]

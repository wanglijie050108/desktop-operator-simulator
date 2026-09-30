from __future__ import annotations

import pytest

from desktop_agent.redaction import redact_text


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("call 13812345678 now", "call ***-***-5678 now"),
        ("card 6222021234567890 used", "card ***-***-7890 used"),
        ("only 12345 stays", "only 12345 stays"),
        (
            "account test.user@example.com signed in",
            "account [REDACTED]@example.com signed in",
        ),
        (
            "visit https://admin:secret@example.com/path",
            "visit https://[REDACTED]@example.com/path",
        ),
        ("token=abc.def-ghi end", "token=[REDACTED] end"),
        ("password: hunter2!", "password: [REDACTED]"),
        ("密钥=abc123 完成", "密钥=[REDACTED] 完成"),
    ],
)
def test_redacts_sensitive_values(source: str, expected: str) -> None:
    assert redact_text(source) == expected


def test_handles_empty_and_plain_text() -> None:
    assert redact_text(None) == ""
    assert redact_text("") == ""
    assert redact_text("任务完成，耗时 320ms") == "任务完成，耗时 320ms"

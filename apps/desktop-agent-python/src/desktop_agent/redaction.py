"""Conservative masking for values that must not reach Agent logs."""

from __future__ import annotations

import re

_EMAIL_PATTERN = re.compile(r"([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})")
_URL_CREDENTIAL_PATTERN = re.compile(r"(https?://)[^/\s@]+@", re.IGNORECASE)
_SECRET_ASSIGNMENT_PATTERN = re.compile(
    r"(?i:(?<![A-Za-z0-9_])"
    r"((?:password|passwd|secret|token|api[-_]?key|密码|令牌|密钥)\s*[:=]\s*))"
    r"[^\s,;]+"
)
_LONG_DIGIT_PATTERN = re.compile(r"\d{7,}")


def redact_text(text: str | None) -> str:
    if not text:
        return ""

    redacted = _EMAIL_PATTERN.sub(lambda match: f"[REDACTED]@{match.group(2)}", text)
    redacted = _URL_CREDENTIAL_PATTERN.sub(
        lambda match: f"{match.group(1)}[REDACTED]@",
        redacted,
    )
    redacted = _SECRET_ASSIGNMENT_PATTERN.sub(
        lambda match: f"{match.group(1)}[REDACTED]",
        redacted,
    )
    return _LONG_DIGIT_PATTERN.sub(_mask_digits, redacted)


def _mask_digits(match: re.Match[str]) -> str:
    digits = match.group(0)
    return f"***-***-{digits[-4:]}"

from __future__ import annotations

from datetime import timedelta

import pytest

from desktop_agent.policy import ALL_DESKTOP_ACTIONS, AgentCommandPolicy


def test_parse_empty_allowlist_enables_known_actions() -> None:
    assert AgentCommandPolicy.parse_allowed_actions(None) == ALL_DESKTOP_ACTIONS
    assert AgentCommandPolicy.parse_allowed_actions("  ") == ALL_DESKTOP_ACTIONS


def test_parse_allowlist_preserves_explicit_selection() -> None:
    assert AgentCommandPolicy.parse_allowed_actions(
        "WINDOW_ACTIVATE, TAKE_SCREENSHOT"
    ) == frozenset({"WINDOW_ACTIVATE", "TAKE_SCREENSHOT"})


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("UNKNOWN_ACTION", "Unknown desktop action"),
        (",,", "At least one allowed action"),
    ],
)
def test_parse_allowlist_rejects_invalid_values(value: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        AgentCommandPolicy.parse_allowed_actions(value)


def test_policy_rejects_invalid_configuration() -> None:
    with pytest.raises(ValueError, match="At least one"):
        AgentCommandPolicy(frozenset())
    with pytest.raises(ValueError, match="lifetime"):
        AgentCommandPolicy(maximum_command_lifetime=timedelta(0))

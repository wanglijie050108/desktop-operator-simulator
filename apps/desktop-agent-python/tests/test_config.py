from __future__ import annotations

from uuid import UUID

import pytest

from desktop_agent.config import AgentOptions
from desktop_agent.policy import ALL_DESKTOP_ACTIONS
from desktop_agent.protocol import AgentCapability


def test_loads_safe_defaults() -> None:
    options = AgentOptions.from_environment({})

    assert options.server_url == "ws://127.0.0.1:7070/ws/agent"
    assert options.agent_id == UUID("00000000-0000-4000-8000-000000000001")
    assert options.name == "python-placeholder-agent"
    assert options.capabilities == ()
    assert options.allowed_actions == ALL_DESKTOP_ACTIONS
    assert not options.windows_automation_enabled
    assert options.allowed_processes == frozenset()


def test_loads_environment_overrides() -> None:
    options = AgentOptions.from_environment(
        {
            "CONTROL_SERVER_WS_URL": "wss://localhost:7443/ws/agent",
            "AGENT_ID": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "AGENT_NAME": "python-agent",
            "AGENT_ALLOWED_ACTIONS": "WINDOW_ACTIVATE,TAKE_SCREENSHOT",
        }
    )

    assert options.server_url == "wss://localhost:7443/ws/agent"
    assert options.agent_id == UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    assert options.name == "python-agent"
    assert options.allowed_actions == frozenset({"WINDOW_ACTIVATE", "TAKE_SCREENSHOT"})


@pytest.mark.parametrize(
    ("environment", "message"),
    [
        ({"CONTROL_SERVER_WS_URL": "http://127.0.0.1:7070"}, "ws or wss"),
        ({"CONTROL_SERVER_WS_URL": "ws://192.168.1.20:7070/ws/agent"}, "loopback"),
        ({"CONTROL_SERVER_WS_URL": "ws://user:secret@localhost:7070/ws/agent"}, "credentials"),
        ({"AGENT_ID": "not-a-uuid"}, "must be a UUID"),
        ({"AGENT_ID": "00000000-0000-0000-0000-000000000000"}, "must not be empty"),
        ({"AGENT_NAME": ""}, "between 1 and 100"),
        ({"AGENT_ALLOWED_ACTIONS": "RUN_SCRIPT"}, "Unknown desktop action"),
    ],
)
def test_rejects_unsafe_or_invalid_environment(environment: dict[str, str], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        AgentOptions.from_environment(environment)


def test_rejects_invalid_retry_and_handshake_configuration() -> None:
    with pytest.raises(ValueError, match="Initial reconnect"):
        AgentOptions(initial_reconnect_delay=0).validate()
    with pytest.raises(ValueError, match="Maximum reconnect"):
        AgentOptions(initial_reconnect_delay=2, maximum_reconnect_delay=1).validate()
    with pytest.raises(ValueError, match="Handshake timeout"):
        AgentOptions(handshake_timeout=0).validate()


def test_enables_windows_automation_with_explicit_process_allowlist() -> None:
    options = AgentOptions.from_environment(
        {
            "AGENT_WINDOWS_AUTOMATION_ENABLED": "true",
            "AGENT_ALLOWED_PROCESSES": "notepad.exe, WeChat.exe",
            "AGENT_ARTIFACT_DIR": "C:/automation-data/artifacts",
        }
    )

    assert options.windows_automation_enabled
    assert options.allowed_processes == frozenset({"notepad.exe", "wechat.exe"})
    assert options.capabilities == (
        AgentCapability.INPUT,
        AgentCapability.CLIPBOARD,
        AgentCapability.SCREENSHOT,
    )
    assert str(options.artifact_directory) == "C:/automation-data/artifacts"


@pytest.mark.parametrize(
    ("environment", "message"),
    [
        ({"AGENT_WINDOWS_AUTOMATION_ENABLED": "yes"}, "true or false"),
        ({"AGENT_WINDOWS_AUTOMATION_ENABLED": "true"}, "AGENT_ALLOWED_PROCESSES"),
        ({"AGENT_ALLOWED_PROCESSES": "../notepad.exe"}, "Invalid allowed process"),
        ({"AGENT_ARTIFACT_DIR": "  "}, "must not be empty"),
    ],
)
def test_rejects_invalid_windows_automation_configuration(
    environment: dict[str, str],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        AgentOptions.from_environment(environment)

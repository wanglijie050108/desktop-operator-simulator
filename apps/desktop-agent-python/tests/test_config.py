from __future__ import annotations

from pathlib import Path
from uuid import UUID

import pytest

from desktop_agent.config import AgentOptions
from desktop_agent.policy import ALL_DESKTOP_ACTIONS
from desktop_agent.protocol import AgentCapability
from desktop_agent.windows_executor import DisplayProfile


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
        AgentCapability.MOUSE,
        AgentCapability.CLIPBOARD,
        AgentCapability.SCREENSHOT,
    )
    assert options.artifact_directory == Path("C:/automation-data/artifacts")


def test_enables_wechat_capabilities_when_ingress_and_send_enabled() -> None:
    options = AgentOptions.from_environment(
        {
            "AGENT_WINDOWS_AUTOMATION_ENABLED": "true",
            "AGENT_ALLOWED_PROCESSES": "WeChat.exe",
            "AGENT_WECHAT_INGRESS_ENABLED": "true",
            "AGENT_WECHAT_SEND_ENABLED": "true",
            "AGENT_WECHAT_PROCESS": "WeChat.exe",
            "AGENT_IDENTITY_KEY": "00" * 32,
        }
    )

    assert options.wechat_ingress_enabled
    assert options.wechat_send_enabled
    assert options.wechat_process_name == "WeChat.exe"
    assert len(options.identity_key) == 32
    assert options.capabilities == (
        AgentCapability.INPUT,
        AgentCapability.MOUSE,
        AgentCapability.CLIPBOARD,
        AgentCapability.SCREENSHOT,
        AgentCapability.WECHAT_READ,
        AgentCapability.WECHAT_SEND,
    )


def test_wechat_ingress_requires_windows_automation() -> None:
    with pytest.raises(ValueError, match="AGENT_WECHAT_INGRESS_ENABLED"):
        AgentOptions.from_environment(
            {
                "AGENT_WECHAT_INGRESS_ENABLED": "true",
                "AGENT_IDENTITY_KEY": "00" * 32,
            }
        )


def test_wechat_ingress_requires_identity_key() -> None:
    with pytest.raises(ValueError, match="AGENT_IDENTITY_KEY"):
        AgentOptions.from_environment(
            {
                "AGENT_WINDOWS_AUTOMATION_ENABLED": "true",
                "AGENT_ALLOWED_PROCESSES": "WeChat.exe",
                "AGENT_WECHAT_INGRESS_ENABLED": "true",
            }
        )


def test_rejects_invalid_wechat_process_name() -> None:
    with pytest.raises(ValueError, match="AGENT_WECHAT_PROCESS"):
        AgentOptions.from_environment(
            {
                "AGENT_WINDOWS_AUTOMATION_ENABLED": "true",
                "AGENT_ALLOWED_PROCESSES": "WeChat.exe",
                "AGENT_WECHAT_SEND_ENABLED": "true",
                "AGENT_WECHAT_PROCESS": "../wechat.exe",
            }
        )


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


def test_coordinate_mouse_is_disabled_by_default() -> None:
    options = AgentOptions.from_environment(
        {
            "AGENT_WINDOWS_AUTOMATION_ENABLED": "true",
            "AGENT_ALLOWED_PROCESSES": "notepad.exe",
        }
    )

    assert options.coordinate_mouse_profile is None


def test_coordinate_mouse_profile_is_parsed_when_configured() -> None:
    options = AgentOptions.from_environment(
        {
            "AGENT_WINDOWS_AUTOMATION_ENABLED": "true",
            "AGENT_ALLOWED_PROCESSES": "notepad.exe",
            "AGENT_COORDINATE_MOUSE_PROFILE": "1920x1080@96",
        }
    )

    assert options.coordinate_mouse_profile == DisplayProfile(width=1920, height=1080, dpi=96)


@pytest.mark.parametrize(
    "value",
    [
        "1920x1080",
        "1920*1080@96",
        "1920x1080@096x",
        "100x1080@96",
        "1920x1080@1000",
    ],
)
def test_rejects_invalid_coordinate_mouse_profiles(value: str) -> None:
    with pytest.raises(ValueError, match="AGENT_COORDINATE_MOUSE_PROFILE"):
        AgentOptions.from_environment({"AGENT_COORDINATE_MOUSE_PROFILE": value})

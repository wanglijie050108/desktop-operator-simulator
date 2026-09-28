from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from desktop_agent.protocol import (
    MAXIMUM_MESSAGE_BYTES,
    AgentHeartbeat,
    AgentHello,
    ChatMessageReceived,
    DesktopCommand,
    DesktopCommandResult,
    EmergencyStop,
    ProtocolError,
    ServerWelcome,
    TaskCancel,
    parse_agent_message,
    parse_server_message,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_PATH = REPOSITORY_ROOT / "contracts/fixtures/websocket-v1/messages.json"

AGENT_TYPES = {
    "agent.hello": AgentHello,
    "agent.heartbeat": AgentHeartbeat,
    "chat.message.received": ChatMessageReceived,
    "desktop.command.result": DesktopCommandResult,
}
SERVER_TYPES = {
    "server.welcome": ServerWelcome,
    "desktop.command": DesktopCommand,
    "task.cancel": TaskCancel,
    "system.emergency-stop": EmergencyStop,
    "server.error": ProtocolError,
}


def envelope(message_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "type": message_type,
        "messageId": "11111111-1111-4111-8111-111111111111",
        "timestamp": "2026-09-24T04:00:00Z",
        "payload": payload,
    }


def test_shared_fixtures_deserialize_with_strict_contracts() -> None:
    fixtures: list[dict[str, Any]] = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    for fixture in fixtures:
        message_type = fixture["type"]
        raw = json.dumps(fixture)
        if message_type in AGENT_TYPES:
            agent_message = parse_agent_message(raw)
            assert isinstance(agent_message, AGENT_TYPES[message_type])
        else:
            server_message = parse_server_message(raw)
            assert isinstance(server_message, SERVER_TYPES[message_type])


@pytest.mark.parametrize(
    ("action", "arguments"),
    [
        ("WECHAT_READ_NEW_MESSAGES", {}),
        ("WECHAT_SEND_TEXT", {"conversationId": "conversation", "text": "reply"}),
        ("WINDOW_ACTIVATE", {"processName": "WeChat", "titleContains": "WeChat"}),
        ("TAKE_SCREENSHOT", {"artifactName": "task_capture_1"}),
        ("CLIPBOARD_SET_TEXT", {"text": ""}),
        ("INPUT_KEY_CHORD", {"keys": ["CTRL", "V"]}),
    ],
)
def test_every_desktop_action_has_a_strict_payload(action: str, arguments: dict[str, Any]) -> None:
    message = envelope(
        "desktop.command",
        {
            "commandId": "55555555-5555-4555-8555-555555555555",
            "taskId": "66666666-6666-4666-8666-666666666666",
            "expiresAt": "2026-09-24T04:01:30Z",
            "action": action,
            "arguments": arguments,
        },
    )

    parsed = parse_server_message(json.dumps(message))

    assert isinstance(parsed, DesktopCommand)
    assert parsed.payload.action == action


def test_unknown_properties_are_rejected() -> None:
    message = envelope(
        "agent.hello",
        {
            "agentId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "name": "fixture-agent",
            "version": "0.1.0",
            "capabilities": [],
            "arbitraryScript": "not allowed",
        },
    )

    with pytest.raises(ValidationError):
        parse_agent_message(json.dumps(message))


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("schemaVersion", "2.0"),
        ("messageId", "00000000-0000-0000-0000-000000000000"),
        ("timestamp", "2026-09-24T12:00:00+08:00"),
    ],
)
def test_invalid_envelope_is_rejected(field: str, value: str) -> None:
    message = envelope(
        "agent.hello",
        {
            "agentId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "name": "fixture-agent",
            "version": "0.1.0",
            "capabilities": [],
        },
    )
    message[field] = value

    with pytest.raises(ValidationError):
        parse_agent_message(json.dumps(message))


def test_duplicate_capabilities_and_keys_are_rejected() -> None:
    hello = envelope(
        "agent.hello",
        {
            "agentId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "name": "fixture-agent",
            "version": "0.1.0",
            "capabilities": ["input", "input"],
        },
    )
    command = envelope(
        "desktop.command",
        {
            "commandId": "55555555-5555-4555-8555-555555555555",
            "taskId": "66666666-6666-4666-8666-666666666666",
            "expiresAt": "2026-09-24T04:01:30Z",
            "action": "INPUT_KEY_CHORD",
            "arguments": {"keys": ["CTRL", "CTRL"]},
        },
    )

    with pytest.raises(ValidationError):
        parse_agent_message(json.dumps(hello))
    with pytest.raises(ValidationError):
        parse_server_message(json.dumps(command))


def test_wrong_action_arguments_are_rejected() -> None:
    command = envelope(
        "desktop.command",
        {
            "commandId": "55555555-5555-4555-8555-555555555555",
            "taskId": "66666666-6666-4666-8666-666666666666",
            "expiresAt": "2026-09-24T04:01:30Z",
            "action": "WECHAT_SEND_TEXT",
            "arguments": {"conversationId": "conversation", "keys": ["CTRL", "V"]},
        },
    )

    with pytest.raises(ValidationError):
        parse_server_message(json.dumps(command))


def test_oversized_messages_are_rejected_before_parsing() -> None:
    oversized = "x" * (MAXIMUM_MESSAGE_BYTES + 1)

    with pytest.raises(ValueError, match="size limit"):
        parse_agent_message(oversized)

from __future__ import annotations

import json

import pytest

from desktop_agent.execution import PlaceholderCommandHandler
from desktop_agent.protocol import AgentStatus, CommandOutcome, DesktopCommand, parse_server_message


def command() -> DesktopCommand:
    parsed = parse_server_message(
        json.dumps(
            {
                "schemaVersion": "1.0",
                "type": "desktop.command",
                "messageId": "11111111-1111-4111-8111-111111111111",
                "timestamp": "2026-09-24T04:00:00Z",
                "payload": {
                    "commandId": "55555555-5555-4555-8555-555555555555",
                    "taskId": "66666666-6666-4666-8666-666666666666",
                    "expiresAt": "2026-09-24T04:01:30Z",
                    "action": "WECHAT_READ_NEW_MESSAGES",
                    "arguments": {},
                },
            }
        )
    )
    assert isinstance(parsed, DesktopCommand)
    return parsed


@pytest.mark.asyncio
async def test_placeholder_fails_closed() -> None:
    handler = PlaceholderCommandHandler()

    result = await handler.execute(command().payload)

    assert handler.status is AgentStatus.ONLINE
    assert result.outcome is CommandOutcome.FAILED
    assert result.error_code == "NOT_IMPLEMENTED"


@pytest.mark.asyncio
async def test_cancelled_task_is_rejected() -> None:
    handler = PlaceholderCommandHandler()
    desktop_command = command()
    handler.cancel_task(desktop_command.payload.task_id)

    result = await handler.execute(desktop_command.payload)

    assert result.outcome is CommandOutcome.REJECTED
    assert result.error_code == "TASK_CANCELLED"


@pytest.mark.asyncio
async def test_emergency_stop_pauses_handler() -> None:
    handler = PlaceholderCommandHandler()

    await handler.emergency_stop()
    result = await handler.execute(command().payload)

    assert handler.status is AgentStatus.PAUSED
    assert result.outcome is CommandOutcome.REJECTED
    assert result.error_code == "POLICY_DENIED"

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from threading import Event
from uuid import UUID, uuid4

import pytest

from desktop_agent.execution import (
    CommandDispatcher,
    CommandExecutionResult,
    DesktopActionExecutor,
    PlaceholderDesktopActionExecutor,
)
from desktop_agent.policy import AgentCommandPolicy, CommandDeduplicator
from desktop_agent.protocol import AgentStatus, CommandOutcome, DesktopCommand, parse_server_message

NOW = datetime(2026, 9, 28, 4, 0, tzinfo=UTC)
TASK_ID = UUID("66666666-6666-4666-8666-666666666666")


def command(
    *,
    command_id: UUID | None = None,
    task_id: UUID = TASK_ID,
    expires_at: datetime | None = None,
) -> DesktopCommand:
    parsed = parse_server_message(
        json.dumps(
            {
                "schemaVersion": "1.0",
                "type": "desktop.command",
                "messageId": str(uuid4()),
                "timestamp": NOW.isoformat(),
                "payload": {
                    "commandId": str(command_id or uuid4()),
                    "taskId": str(task_id),
                    "expiresAt": (expires_at or NOW + timedelta(minutes=1)).isoformat(),
                    "action": "WECHAT_READ_NEW_MESSAGES",
                    "arguments": {},
                },
            }
        )
    )
    assert isinstance(parsed, DesktopCommand)
    return parsed


class RecordingExecutor(DesktopActionExecutor):
    def __init__(self, *, block: bool = False) -> None:
        self.block = block
        self.started = asyncio.Event()
        self.executed = 0
        self.emergency_stops = 0
        self.cancellation: Event | None = None

    async def execute(self, command: object, cancellation: Event) -> CommandExecutionResult:
        self.executed += 1
        self.cancellation = cancellation
        self.started.set()
        if self.block:
            await asyncio.Future()
        return CommandExecutionResult.succeeded()

    async def emergency_stop(self) -> None:
        self.emergency_stops += 1


class HangingEmergencyStopExecutor(RecordingExecutor):
    async def emergency_stop(self) -> None:
        await asyncio.Future()


def dispatcher(
    executor: DesktopActionExecutor,
    *,
    policy: AgentCommandPolicy | None = None,
    deduplicator: CommandDeduplicator | None = None,
) -> CommandDispatcher:
    return CommandDispatcher(
        executor,
        policy=policy,
        deduplicator=deduplicator,
        clock=lambda: NOW,
    )


def assert_status(handler: CommandDispatcher, expected: AgentStatus) -> None:
    assert handler.status is expected


@pytest.mark.asyncio
async def test_placeholder_fails_closed() -> None:
    handler = dispatcher(PlaceholderDesktopActionExecutor())

    result = await handler.execute(command().payload)

    assert_status(handler, AgentStatus.ONLINE)
    assert result.outcome is CommandOutcome.FAILED
    assert result.error_code == "NOT_IMPLEMENTED"


@pytest.mark.asyncio
async def test_dispatches_allowed_command_once() -> None:
    executor = RecordingExecutor()
    handler = dispatcher(executor)
    desktop_command = command()

    first = await handler.execute(desktop_command.payload)
    duplicate = await handler.execute(desktop_command.payload)

    assert first.outcome is CommandOutcome.SUCCEEDED
    assert duplicate == CommandExecutionResult.rejected("DUPLICATE_COMMAND")
    assert executor.executed == 1


@pytest.mark.asyncio
async def test_rejects_expired_and_excessively_long_commands() -> None:
    executor = RecordingExecutor()
    handler = dispatcher(executor)

    expired = await handler.execute(command(expires_at=NOW).payload)
    excessive = await handler.execute(command(expires_at=NOW + timedelta(minutes=11)).payload)

    assert expired == CommandExecutionResult.rejected("COMMAND_EXPIRED")
    assert excessive == CommandExecutionResult.rejected("COMMAND_EXPIRY_INVALID")
    assert executor.executed == 0


@pytest.mark.asyncio
async def test_rejects_action_outside_allowlist() -> None:
    executor = RecordingExecutor()
    handler = dispatcher(
        executor,
        policy=AgentCommandPolicy(frozenset({"TAKE_SCREENSHOT"})),
    )

    result = await handler.execute(command().payload)

    assert result == CommandExecutionResult.rejected("POLICY_DENIED")
    assert executor.executed == 0


@pytest.mark.asyncio
async def test_cancel_interrupts_active_command_and_rejects_task_reuse() -> None:
    executor = RecordingExecutor(block=True)
    handler = dispatcher(executor)
    desktop_command = command()
    execution = asyncio.create_task(handler.execute(desktop_command.payload))
    await asyncio.wait_for(executor.started.wait(), timeout=1)

    assert_status(handler, AgentStatus.BUSY)
    assert handler.active_command_id == desktop_command.payload.command_id

    await handler.cancel_task(TASK_ID)
    result = await asyncio.wait_for(execution, timeout=1)
    follow_up = await handler.execute(command().payload)

    assert result == CommandExecutionResult.rejected("TASK_CANCELLED")
    assert follow_up == CommandExecutionResult.rejected("TASK_CANCELLED")
    assert executor.cancellation is not None
    assert executor.cancellation.is_set()
    assert_status(handler, AgentStatus.ONLINE)
    assert handler.active_command_id is None


@pytest.mark.asyncio
async def test_emergency_stop_interrupts_command_releases_input_and_pauses() -> None:
    executor = RecordingExecutor(block=True)
    handler = dispatcher(executor)
    execution = asyncio.create_task(handler.execute(command().payload))
    await asyncio.wait_for(executor.started.wait(), timeout=1)

    await handler.emergency_stop()
    result = await asyncio.wait_for(execution, timeout=1)
    paused = await handler.execute(command().payload)

    assert result == CommandExecutionResult.rejected("TASK_CANCELLED")
    assert paused == CommandExecutionResult.rejected("POLICY_DENIED")
    assert executor.emergency_stops == 1
    assert executor.cancellation is not None
    assert executor.cancellation.is_set()
    assert_status(handler, AgentStatus.PAUSED)

    await handler.reset_emergency_stop()
    assert_status(handler, AgentStatus.ONLINE)


@pytest.mark.asyncio
async def test_emergency_stop_times_out_and_remains_paused() -> None:
    handler = CommandDispatcher(
        HangingEmergencyStopExecutor(),
        clock=lambda: NOW,
        emergency_stop_timeout=0.01,
    )

    with pytest.raises(TimeoutError):
        await handler.emergency_stop()

    assert_status(handler, AgentStatus.PAUSED)


def test_dispatcher_rejects_invalid_emergency_stop_timeout() -> None:
    with pytest.raises(ValueError, match="Emergency stop timeout"):
        CommandDispatcher(RecordingExecutor(), emergency_stop_timeout=0)


def test_deduplicator_expires_and_evicts_entries() -> None:
    deduplicator = CommandDeduplicator(timedelta(minutes=1), capacity=1)
    first = uuid4()
    second = uuid4()

    assert deduplicator.try_register(first, NOW)
    assert deduplicator.try_register(second, NOW + timedelta(seconds=1))
    assert deduplicator.try_register(first, NOW + timedelta(seconds=2))
    assert deduplicator.try_register(first, NOW + timedelta(minutes=2))


@pytest.mark.parametrize(
    ("retention", "capacity", "message"),
    [
        (timedelta(0), 1, "retention"),
        (timedelta(minutes=1), 0, "capacity"),
    ],
)
def test_deduplicator_rejects_invalid_configuration(
    retention: timedelta,
    capacity: int,
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        CommandDeduplicator(retention, capacity)

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest

from desktop_agent.client import AgentClient, AgentEventPump
from desktop_agent.config import AgentOptions
from desktop_agent.execution import CommandExecutionResult, CommandHandler
from desktop_agent.protocol import (
    AgentCapability,
    AgentHeartbeat,
    AgentHello,
    AgentStatus,
    AgentToServerMessage,
    ChatMessageReceived,
    ChatMessageReceivedPayload,
    CommandOutcome,
    DesktopCommandPayload,
    DesktopCommandResult,
    parse_agent_message,
)

TEST_TIMEOUT = 2.0
AGENT_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
TASK_ID = UUID("66666666-6666-4666-8666-666666666666")


class FakeSocket:
    def __init__(self) -> None:
        self.incoming: asyncio.Queue[str] = asyncio.Queue()
        self.outgoing: asyncio.Queue[str] = asyncio.Queue()

    async def recv(self) -> str:
        return await self.incoming.get()

    async def send(self, message: str) -> None:
        await self.outgoing.put(message)


class ControlledHandler(CommandHandler):
    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.cancelled = asyncio.Event()
        self.release = asyncio.Event()
        self.emergency_stopped = False

    @property
    def status(self) -> AgentStatus:
        return AgentStatus.PAUSED if self.emergency_stopped else AgentStatus.ONLINE

    @property
    def active_command_id(self) -> UUID | None:
        return None

    async def execute(self, command: DesktopCommandPayload) -> CommandExecutionResult:
        self.started.set()
        await self.release.wait()
        if self.cancelled.is_set():
            return CommandExecutionResult.rejected("TASK_CANCELLED")
        return CommandExecutionResult.failed("NOT_IMPLEMENTED")

    async def cancel_task(self, task_id: UUID) -> None:
        if task_id == TASK_ID:
            self.cancelled.set()
            self.release.set()

    async def emergency_stop(self) -> None:
        self.emergency_stopped = True
        self.cancelled.set()
        self.release.set()


class OneShotMessagePump(AgentEventPump):
    def __init__(self, message: ChatMessageReceived) -> None:
        self.message = message

    async def run(
        self,
        publish: Callable[[ChatMessageReceived], Awaitable[None]],
        stop_event: asyncio.Event,
    ) -> None:
        await publish(self.message)
        await stop_event.wait()


def server_message(message_type: str, payload: dict[str, Any]) -> str:
    return json.dumps(
        {
            "schemaVersion": "1.0",
            "type": message_type,
            "messageId": "11111111-1111-4111-8111-111111111111",
            "timestamp": "2026-09-24T04:00:00Z",
            "payload": payload,
        }
    )


def desktop_command() -> str:
    return server_message(
        "desktop.command",
        {
            "commandId": "55555555-5555-4555-8555-555555555555",
            "taskId": str(TASK_ID),
            "expiresAt": "2026-09-24T04:01:30Z",
            "action": "WECHAT_READ_NEW_MESSAGES",
            "arguments": {},
        },
    )


async def next_outgoing(socket: FakeSocket, expected_type: str) -> AgentToServerMessage:
    raw = await asyncio.wait_for(socket.outgoing.get(), TEST_TIMEOUT)
    parsed = parse_agent_message(raw)
    assert parsed.type == expected_type
    return parsed


def create_client(
    handler: CommandHandler,
    *,
    message_pump: AgentEventPump | None = None,
) -> AgentClient:
    return AgentClient(
        AgentOptions(
            agent_id=AGENT_ID,
            name="python-test-agent",
            capabilities=((AgentCapability.WECHAT_READ,) if message_pump is not None else ()),
            handshake_timeout=TEST_TIMEOUT,
        ),
        handler,
        message_pump=message_pump,
    )


@pytest.mark.asyncio
async def test_session_registers_and_sends_heartbeat() -> None:
    socket = FakeSocket()
    handler = ControlledHandler()
    stop = asyncio.Event()
    client = create_client(handler)
    session = asyncio.create_task(client.run_session(socket, stop))

    hello = await next_outgoing(socket, "agent.hello")
    assert isinstance(hello, AgentHello)
    assert hello.payload.agent_id == AGENT_ID

    await socket.incoming.put(
        server_message(
            "server.welcome",
            {"heartbeatIntervalMs": 1_000, "serverVersion": "test"},
        )
    )
    heartbeat = await next_outgoing(socket, "agent.heartbeat")
    assert isinstance(heartbeat, AgentHeartbeat)
    assert heartbeat.payload.status is AgentStatus.ONLINE

    stop.set()
    await asyncio.wait_for(session, TEST_TIMEOUT)


@pytest.mark.asyncio
async def test_cancel_frame_reaches_handler_while_command_runs() -> None:
    socket = FakeSocket()
    handler = ControlledHandler()
    stop = asyncio.Event()
    client = create_client(handler)
    session = asyncio.create_task(client.run_session(socket, stop))

    await next_outgoing(socket, "agent.hello")
    await socket.incoming.put(
        server_message(
            "server.welcome",
            {"heartbeatIntervalMs": 60_000, "serverVersion": "test"},
        )
    )
    await socket.incoming.put(desktop_command())
    await asyncio.wait_for(handler.started.wait(), TEST_TIMEOUT)
    await socket.incoming.put(server_message("task.cancel", {"taskId": str(TASK_ID)}))
    await asyncio.wait_for(handler.cancelled.wait(), TEST_TIMEOUT)

    result = await next_outgoing(socket, "desktop.command.result")
    assert isinstance(result, DesktopCommandResult)
    assert result.payload.outcome is CommandOutcome.REJECTED
    assert result.payload.error_code == "TASK_CANCELLED"

    stop.set()
    await asyncio.wait_for(session, TEST_TIMEOUT)


@pytest.mark.asyncio
async def test_emergency_stop_changes_heartbeat_status() -> None:
    socket = FakeSocket()
    handler = ControlledHandler()
    stop = asyncio.Event()
    client = create_client(handler)
    session = asyncio.create_task(client.run_session(socket, stop))

    await next_outgoing(socket, "agent.hello")
    await socket.incoming.put(
        server_message(
            "server.welcome",
            {"heartbeatIntervalMs": 1_000, "serverVersion": "test"},
        )
    )
    await socket.incoming.put(
        server_message("system.emergency-stop", {"reason": "operator triggered"})
    )

    heartbeat = await next_outgoing(socket, "agent.heartbeat")
    assert isinstance(heartbeat, AgentHeartbeat)
    assert heartbeat.payload.status is AgentStatus.PAUSED

    stop.set()
    await asyncio.wait_for(session, TEST_TIMEOUT)


@pytest.mark.asyncio
async def test_session_rejects_non_welcome_first_message() -> None:
    socket = FakeSocket()
    client = create_client(ControlledHandler())
    stop = asyncio.Event()
    await socket.incoming.put(server_message("task.cancel", {"taskId": str(TASK_ID)}))

    with pytest.raises(ValueError, match="server.welcome"):
        await client.run_session(socket, stop)


@pytest.mark.asyncio
async def test_session_publishes_message_pump_events() -> None:
    event = ChatMessageReceived(
        schema_version="1.0",
        type="chat.message.received",
        message_id=uuid4(),
        timestamp=datetime.now(UTC),
        payload=ChatMessageReceivedPayload(
            source="WECHAT",
            external_message_id="wechat:fixture",
            conversation_id="hmac-sha256:conversation",
            sender_id="hmac-sha256:sender",
            content="#assistant fixture",
            received_at=datetime.now(UTC),
        ),
    )
    socket = FakeSocket()
    stop = asyncio.Event()
    client = create_client(
        ControlledHandler(),
        message_pump=OneShotMessagePump(event),
    )
    session = asyncio.create_task(client.run_session(socket, stop))

    await next_outgoing(socket, "agent.hello")
    await socket.incoming.put(
        server_message(
            "server.welcome",
            {"heartbeatIntervalMs": 60_000, "serverVersion": "test"},
        )
    )
    outgoing = await next_outgoing(socket, "chat.message.received")

    assert isinstance(outgoing, ChatMessageReceived)
    assert outgoing.payload.external_message_id == "wechat:fixture"

    stop.set()
    await asyncio.wait_for(session, TEST_TIMEOUT)


def test_message_pump_requires_declared_capability() -> None:
    event = ChatMessageReceived(
        schema_version="1.0",
        type="chat.message.received",
        message_id=uuid4(),
        timestamp=datetime.now(UTC),
        payload=ChatMessageReceivedPayload(
            source="WECHAT",
            external_message_id="wechat:fixture",
            conversation_id="hmac-sha256:conversation",
            sender_id="hmac-sha256:sender",
            content="#assistant fixture",
            received_at=datetime.now(UTC),
        ),
    )

    with pytest.raises(ValueError, match="wechat.read"):
        AgentClient(
            AgentOptions(agent_id=AGENT_ID, name="python-test-agent"),
            ControlledHandler(),
            message_pump=OneShotMessagePump(event),
        )

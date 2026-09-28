"""Async WebSocket client for the Python Desktop Agent."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid4

from websockets.asyncio.client import connect

from .config import AgentOptions
from .execution import CommandExecutionResult, CommandHandler
from .protocol import (
    SCHEMA_VERSION,
    AgentHeartbeat,
    AgentHeartbeatPayload,
    AgentHello,
    AgentHelloPayload,
    DesktopCommand,
    DesktopCommandResult,
    DesktopCommandResultPayload,
    EmergencyStop,
    ProtocolError,
    ServerWelcome,
    TaskCancel,
    parse_server_message,
    serialize_message,
)


class WebSocketConnection(Protocol):
    async def recv(self) -> str | bytes: ...

    async def send(self, message: str) -> None: ...


class AgentClient:
    def __init__(
        self,
        options: AgentOptions,
        handler: CommandHandler,
        *,
        log: Callable[[str], None] | None = None,
    ) -> None:
        options.validate()
        self._options = options
        self._handler = handler
        self._log = log or (lambda _message: None)

    async def run(self, stop_event: asyncio.Event | None = None) -> None:
        stop = stop_event or asyncio.Event()
        reconnect_delay = self._options.initial_reconnect_delay

        while not stop.is_set():
            try:
                async with connect(
                    self._options.server_url,
                    max_size=64 * 1024,
                    open_timeout=self._options.handshake_timeout,
                    close_timeout=5,
                ) as socket:
                    await self.run_session(socket, stop)
                    reconnect_delay = self._options.initial_reconnect_delay
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self._log(f"Agent connection failed: {type(error).__name__}")

            if stop.is_set():
                return

            try:
                await asyncio.wait_for(stop.wait(), timeout=reconnect_delay)
            except TimeoutError:
                reconnect_delay = min(
                    reconnect_delay * 2,
                    self._options.maximum_reconnect_delay,
                )

    async def run_session(
        self,
        socket: WebSocketConnection,
        stop_event: asyncio.Event,
    ) -> None:
        send_lock = asyncio.Lock()
        await self._send(socket, self._create_hello(), send_lock)

        raw_welcome = await asyncio.wait_for(
            socket.recv(),
            timeout=self._options.handshake_timeout,
        )
        welcome = parse_server_message(raw_welcome)
        if not isinstance(welcome, ServerWelcome):
            raise ValueError("First server message must be server.welcome")

        commands: asyncio.Queue[DesktopCommand] = asyncio.Queue()
        receive_task = asyncio.create_task(
            self._receive_loop(socket, commands, stop_event),
            name="agent-receive",
        )
        heartbeat_task = asyncio.create_task(
            self._heartbeat_loop(
                socket,
                send_lock,
                welcome.payload.heartbeat_interval_ms / 1_000,
                stop_event,
            ),
            name="agent-heartbeat",
        )
        command_task = asyncio.create_task(
            self._command_loop(socket, send_lock, commands, stop_event),
            name="agent-command",
        )
        stop_task = asyncio.create_task(stop_event.wait(), name="agent-stop")
        tasks = {receive_task, heartbeat_task, command_task, stop_task}

        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

        for task in done:
            if task is not stop_task:
                task.result()

    async def _receive_loop(
        self,
        socket: WebSocketConnection,
        commands: asyncio.Queue[DesktopCommand],
        stop_event: asyncio.Event,
    ) -> None:
        while not stop_event.is_set():
            message = parse_server_message(await socket.recv())
            if isinstance(message, DesktopCommand):
                await commands.put(message)
            elif isinstance(message, TaskCancel):
                await self._handler.cancel_task(message.payload.task_id)
            elif isinstance(message, EmergencyStop):
                await self._handler.emergency_stop()
            elif isinstance(message, ProtocolError):
                raise RuntimeError(f"Server rejected Agent message: {message.payload.code}")
            else:
                raise ValueError(f"Unexpected server message type: {message.type}")

    async def _heartbeat_loop(
        self,
        socket: WebSocketConnection,
        send_lock: asyncio.Lock,
        interval_seconds: float,
        stop_event: asyncio.Event,
    ) -> None:
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
                return
            except TimeoutError:
                heartbeat = AgentHeartbeat(
                    schema_version=SCHEMA_VERSION,
                    type="agent.heartbeat",
                    message_id=uuid4(),
                    timestamp=datetime.now(UTC),
                    payload=AgentHeartbeatPayload(
                        agent_id=self._options.agent_id,
                        status=self._handler.status,
                        active_command_id=self._handler.active_command_id,
                    ),
                )
                await self._send(socket, heartbeat, send_lock)

    async def _command_loop(
        self,
        socket: WebSocketConnection,
        send_lock: asyncio.Lock,
        commands: asyncio.Queue[DesktopCommand],
        stop_event: asyncio.Event,
    ) -> None:
        while not stop_event.is_set():
            command = await commands.get()
            try:
                result = await self._handler.execute(command.payload)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self._log(f"Desktop command failed unexpectedly: {type(error).__name__}")
                result = CommandExecutionResult.failed("DESKTOP_ACTION_FAILED")
            finally:
                commands.task_done()

            response = DesktopCommandResult(
                schema_version=SCHEMA_VERSION,
                type="desktop.command.result",
                message_id=uuid4(),
                timestamp=datetime.now(UTC),
                payload=DesktopCommandResultPayload(
                    command_id=command.payload.command_id,
                    task_id=command.payload.task_id,
                    outcome=result.outcome,
                    error_code=result.error_code,
                ),
            )
            await self._send(socket, response, send_lock)

    def _create_hello(self) -> AgentHello:
        return AgentHello(
            schema_version=SCHEMA_VERSION,
            type="agent.hello",
            message_id=uuid4(),
            timestamp=datetime.now(UTC),
            payload=AgentHelloPayload(
                agent_id=self._options.agent_id,
                name=self._options.name,
                version=self._options.version,
                capabilities=list(self._options.capabilities),
            ),
        )

    @staticmethod
    async def _send(
        socket: WebSocketConnection,
        message: AgentHello | AgentHeartbeat | DesktopCommandResult,
        send_lock: asyncio.Lock,
    ) -> None:
        encoded = serialize_message(message)
        async with send_lock:
            await socket.send(encoded)

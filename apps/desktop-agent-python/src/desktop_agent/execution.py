"""Policy-enforcing command dispatcher and desktop execution boundary."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Event
from typing import Protocol
from uuid import UUID

from .policy import AgentCommandPolicy, CommandDeduplicator
from .protocol import (
    AgentStatus,
    CommandOutcome,
    DesktopCommandPayload,
    WeChatReadNewMessagesPayload,
)

EMERGENCY_STOP_TIMEOUT_SECONDS = 2.0


@dataclass(frozen=True, slots=True)
class CommandExecutionResult:
    outcome: CommandOutcome
    error_code: str | None = None

    @classmethod
    def failed(cls, error_code: str) -> CommandExecutionResult:
        return cls(CommandOutcome.FAILED, error_code)

    @classmethod
    def rejected(cls, error_code: str) -> CommandExecutionResult:
        return cls(CommandOutcome.REJECTED, error_code)

    @classmethod
    def succeeded(cls) -> CommandExecutionResult:
        return cls(CommandOutcome.SUCCEEDED)


class DesktopActionExecutor(Protocol):
    """Windows executors must poll cancellation from worker threads between UI actions."""

    async def execute(
        self,
        command: DesktopCommandPayload,
        cancellation: Event,
    ) -> CommandExecutionResult: ...

    async def emergency_stop(self) -> None: ...


class CommandHandler(Protocol):
    @property
    def status(self) -> AgentStatus: ...

    @property
    def active_command_id(self) -> UUID | None: ...

    async def execute(self, command: DesktopCommandPayload) -> CommandExecutionResult: ...

    async def cancel_task(self, task_id: UUID) -> None: ...

    async def emergency_stop(self) -> None: ...


@dataclass(slots=True)
class PlaceholderDesktopActionExecutor:
    """Fails closed until a Windows-targeted executor is implemented."""

    async def execute(
        self,
        command: DesktopCommandPayload,
        cancellation: Event,
    ) -> CommandExecutionResult:
        if cancellation.is_set():
            return CommandExecutionResult.rejected("TASK_CANCELLED")
        return CommandExecutionResult.failed("NOT_IMPLEMENTED")

    async def emergency_stop(self) -> None:
        # The Windows implementation must release every held key and mouse button.
        return None


class CommandDispatcher:
    """Serializes commands and owns their cancellation lifecycle."""

    def __init__(
        self,
        executor: DesktopActionExecutor,
        *,
        policy: AgentCommandPolicy | None = None,
        deduplicator: CommandDeduplicator | None = None,
        clock: Callable[[], datetime] | None = None,
        emergency_stop_timeout: float = EMERGENCY_STOP_TIMEOUT_SECONDS,
        wechat_read_event: asyncio.Event | None = None,
    ) -> None:
        if emergency_stop_timeout <= 0:
            raise ValueError("Emergency stop timeout must be positive")
        self._executor = executor
        self._policy = policy or AgentCommandPolicy()
        self._deduplicator = deduplicator or CommandDeduplicator()
        self._clock = clock or (lambda: datetime.now(UTC))
        self._emergency_stop_timeout = emergency_stop_timeout
        self._wechat_read_event = wechat_read_event
        self._execution_lock = asyncio.Lock()
        self._state_lock = asyncio.Lock()
        self._cancelled_tasks: set[UUID] = set()
        self._active: dict[UUID, tuple[UUID, Event, asyncio.Task[CommandExecutionResult]]] = {}
        self._emergency_stopped = False

    @property
    def status(self) -> AgentStatus:
        if self._emergency_stopped:
            return AgentStatus.PAUSED
        if self._active:
            return AgentStatus.BUSY
        return AgentStatus.ONLINE

    @property
    def active_command_id(self) -> UUID | None:
        return next(iter(self._active), None)

    async def execute(self, command: DesktopCommandPayload) -> CommandExecutionResult:
        now = self._clock()
        policy_error = self._policy.evaluate(command, now)
        if policy_error is not None:
            return CommandExecutionResult.rejected(policy_error)
        if not self._deduplicator.try_register(command.command_id, now):
            return CommandExecutionResult.rejected("DUPLICATE_COMMAND")

        if self._wechat_read_event is not None and isinstance(
            command, WeChatReadNewMessagesPayload
        ):
            # The ingest pump polls the active conversation on its own interval. This command
            # asks it to poll once immediately; no desktop input is performed here.
            self._wechat_read_event.set()
            return CommandExecutionResult.succeeded()

        async with self._execution_lock:
            async with self._state_lock:
                if self._emergency_stopped:
                    return CommandExecutionResult.rejected("POLICY_DENIED")
                if command.task_id in self._cancelled_tasks:
                    return CommandExecutionResult.rejected("TASK_CANCELLED")

                cancellation = Event()
                execution = asyncio.create_task(
                    self._executor.execute(command, cancellation),
                    name=f"desktop-command-{command.command_id}",
                )
                self._active[command.command_id] = (command.task_id, cancellation, execution)

            try:
                return await execution
            except asyncio.CancelledError:
                async with self._state_lock:
                    cancelled_by_control = (
                        self._emergency_stopped or command.task_id in self._cancelled_tasks
                    )
                if cancelled_by_control:
                    return CommandExecutionResult.rejected("TASK_CANCELLED")
                raise
            finally:
                async with self._state_lock:
                    active = self._active.get(command.command_id)
                    if active is not None and active[2] is execution:
                        del self._active[command.command_id]

    async def cancel_task(self, task_id: UUID) -> None:
        async with self._state_lock:
            self._cancelled_tasks.add(task_id)
            matching = [
                (cancellation, execution)
                for active_task_id, cancellation, execution in self._active.values()
                if active_task_id == task_id
            ]
            for cancellation, execution in matching:
                cancellation.set()
                execution.cancel()

    async def emergency_stop(self) -> None:
        async with self._state_lock:
            self._emergency_stopped = True
            active = [
                (cancellation, execution) for _, cancellation, execution in self._active.values()
            ]
            for cancellation, execution in active:
                cancellation.set()
                execution.cancel()

        async with asyncio.timeout(self._emergency_stop_timeout):
            await self._executor.emergency_stop()

    async def reset_emergency_stop(self) -> None:
        async with self._state_lock:
            self._emergency_stopped = False

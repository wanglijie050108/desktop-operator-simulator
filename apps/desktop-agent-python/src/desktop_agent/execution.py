"""Execution boundary used by the transport layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol
from uuid import UUID

from .protocol import AgentStatus, CommandOutcome, DesktopCommandPayload


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


class CommandHandler(Protocol):
    @property
    def status(self) -> AgentStatus: ...

    async def execute(self, command: DesktopCommandPayload) -> CommandExecutionResult: ...

    def cancel_task(self, task_id: UUID) -> None: ...

    async def emergency_stop(self) -> None: ...


@dataclass(slots=True)
class PlaceholderCommandHandler:
    """Fails closed until the policy dispatcher and Windows executor are implemented."""

    _cancelled_tasks: set[UUID] = field(default_factory=set)
    _emergency_stopped: bool = False

    @property
    def status(self) -> AgentStatus:
        return AgentStatus.PAUSED if self._emergency_stopped else AgentStatus.ONLINE

    async def execute(self, command: DesktopCommandPayload) -> CommandExecutionResult:
        if self._emergency_stopped:
            return CommandExecutionResult.rejected("POLICY_DENIED")
        if command.task_id in self._cancelled_tasks:
            return CommandExecutionResult.rejected("TASK_CANCELLED")
        return CommandExecutionResult.failed("NOT_IMPLEMENTED")

    def cancel_task(self, task_id: UUID) -> None:
        self._cancelled_tasks.add(task_id)

    async def emergency_stop(self) -> None:
        self._emergency_stopped = True

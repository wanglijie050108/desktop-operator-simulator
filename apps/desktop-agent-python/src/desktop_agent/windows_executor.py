"""Windows-only desktop actions behind a cross-platform testable boundary."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from threading import Event, Lock
from typing import Protocol

from .execution import CommandExecutionResult, DesktopActionExecutor
from .protocol import (
    ClipboardSetTextPayload,
    DesktopCommandPayload,
    InputKey,
    InputKeyChordPayload,
    TakeScreenshotPayload,
    WeChatReadNewMessagesPayload,
    WeChatSendTextPayload,
    WindowActivatePayload,
)

_MODIFIER_KEYS = {
    InputKey.CTRL: "^",
    InputKey.ALT: "%",
    InputKey.SHIFT: "+",
}
_TERMINAL_KEYS = {
    InputKey.ENTER: "{ENTER}",
    InputKey.ESCAPE: "{ESC}",
    InputKey.A: "a",
    InputKey.C: "c",
    InputKey.V: "v",
}
_PROCESS_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")


@dataclass(frozen=True, slots=True)
class WindowTarget:
    handle: int
    process_id: int
    process_name: str
    title: str


class WindowsBackend(Protocol):
    def find_window(self, process_name: str, title_contains: str | None) -> WindowTarget: ...

    def activate(self, target: WindowTarget) -> None: ...

    def is_foreground(self, target: WindowTarget) -> bool: ...

    def set_clipboard_text(self, text: str) -> None: ...

    def send_keys(self, keys: str) -> None: ...

    def capture_window(self, target: WindowTarget, destination: Path) -> None: ...

    def release_inputs(self) -> None: ...


class DesktopActionFailure(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class WindowsDesktopActionExecutor(DesktopActionExecutor):
    def __init__(
        self,
        backend: WindowsBackend,
        *,
        allowed_processes: frozenset[str],
        artifact_directory: Path,
    ) -> None:
        if not allowed_processes:
            raise ValueError("At least one allowed process must be configured")
        invalid_processes = [
            name
            for name in allowed_processes
            if PureWindowsPath(name).name != name or _PROCESS_NAME_PATTERN.fullmatch(name) is None
        ]
        if invalid_processes:
            raise ValueError(f"Invalid allowed process name '{sorted(invalid_processes)[0]}'")
        self._backend = backend
        self._allowed_processes = frozenset(
            normalize_process_name(name) for name in allowed_processes
        )
        self._artifact_directory = artifact_directory
        self._state_lock = Lock()
        self._active_target: WindowTarget | None = None

    async def execute(
        self,
        command: DesktopCommandPayload,
        cancellation: Event,
    ) -> CommandExecutionResult:
        if cancellation.is_set():
            return CommandExecutionResult.rejected("TASK_CANCELLED")
        if isinstance(command, (WeChatReadNewMessagesPayload, WeChatSendTextPayload)):
            return CommandExecutionResult.failed("NOT_IMPLEMENTED")

        try:
            return await asyncio.to_thread(self._execute_sync, command, cancellation)
        except DesktopActionFailure as error:
            if error.code in {"POLICY_DENIED", "TASK_CANCELLED", "INVALID_ARGUMENTS"}:
                return CommandExecutionResult.rejected(error.code)
            return CommandExecutionResult.failed(error.code)
        except Exception:
            return CommandExecutionResult.failed("DESKTOP_ACTION_FAILED")

    async def emergency_stop(self) -> None:
        await asyncio.to_thread(self._backend.release_inputs)
        with self._state_lock:
            self._active_target = None

    def _execute_sync(
        self,
        command: DesktopCommandPayload,
        cancellation: Event,
    ) -> CommandExecutionResult:
        _raise_if_cancelled(cancellation)

        if isinstance(command, WindowActivatePayload):
            if (
                PureWindowsPath(command.arguments.process_name).name
                != command.arguments.process_name
            ):
                raise DesktopActionFailure("POLICY_DENIED")
            requested_process = normalize_process_name(command.arguments.process_name)
            if requested_process not in self._allowed_processes:
                raise DesktopActionFailure("POLICY_DENIED")
            target = self._backend.find_window(
                requested_process,
                command.arguments.title_contains,
            )
            _raise_if_cancelled(cancellation)
            self._backend.activate(target)
            if not self._backend.is_foreground(target):
                raise DesktopActionFailure("TARGET_WINDOW_MISMATCH")
            with self._state_lock:
                self._active_target = target
            return CommandExecutionResult.succeeded()

        target = self._require_foreground_target()
        _raise_if_cancelled(cancellation)

        if isinstance(command, ClipboardSetTextPayload):
            self._backend.set_clipboard_text(command.arguments.text)
        elif isinstance(command, InputKeyChordPayload):
            self._backend.send_keys(_format_key_chord(command.arguments.keys))
        elif isinstance(command, TakeScreenshotPayload):
            self._artifact_directory.mkdir(parents=True, exist_ok=True)
            destination = self._artifact_directory / (
                f"{command.arguments.artifact_name}-{command.command_id.hex}.png"
            )
            self._backend.capture_window(target, destination)
        else:
            raise DesktopActionFailure("INVALID_ARGUMENTS")

        _raise_if_cancelled(cancellation)
        if not self._backend.is_foreground(target):
            raise DesktopActionFailure("TARGET_WINDOW_MISMATCH")
        return CommandExecutionResult.succeeded()

    def _require_foreground_target(self) -> WindowTarget:
        with self._state_lock:
            target = self._active_target
        if target is None or not self._backend.is_foreground(target):
            raise DesktopActionFailure("TARGET_WINDOW_MISMATCH")
        return target


def create_windows_executor(
    *,
    allowed_processes: frozenset[str],
    artifact_directory: Path,
) -> WindowsDesktopActionExecutor:
    from .windows_backend import PywinautoWindowsBackend

    return WindowsDesktopActionExecutor(
        PywinautoWindowsBackend(),
        allowed_processes=allowed_processes,
        artifact_directory=artifact_directory,
    )


def normalize_process_name(name: str) -> str:
    basename = PureWindowsPath(name).name.casefold()
    if basename.endswith(".exe"):
        return basename[:-4]
    return basename


def _format_key_chord(keys: list[InputKey]) -> str:
    modifiers = "".join(_MODIFIER_KEYS[key] for key in keys if key in _MODIFIER_KEYS)
    terminals = [_TERMINAL_KEYS[key] for key in keys if key in _TERMINAL_KEYS]
    if len(terminals) != 1:
        raise DesktopActionFailure("INVALID_ARGUMENTS")
    return f"{modifiers}{terminals[0]}"


def _raise_if_cancelled(cancellation: Event) -> None:
    if cancellation.is_set():
        raise DesktopActionFailure("TASK_CANCELLED")

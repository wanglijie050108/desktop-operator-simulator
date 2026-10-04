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
    ControlLocator,
    DesktopCommandPayload,
    InputKey,
    InputKeyChordPayload,
    MouseButton,
    MouseClickPayload,
    MouseClickPositionPayload,
    MouseDragPayload,
    MouseMovePayload,
    MouseScrollPayload,
    TakeScreenshotPayload,
    WeChatSendTextPayload,
    WindowActivatePayload,
    WindowSelector,
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


@dataclass(frozen=True, slots=True)
class ScreenPoint:
    x: int
    y: int


@dataclass(frozen=True, slots=True)
class ElementBounds:
    """Screen rectangle of a window or control, in physical pixels."""

    left: int
    top: int
    width: int
    height: int

    def contains(self, point: ScreenPoint) -> bool:
        return (
            self.left <= point.x < self.left + self.width
            and self.top <= point.y < self.top + self.height
        )


@dataclass(frozen=True, slots=True)
class DisplayProfile:
    """Screen resolution and DPI that window-relative coordinates were calibrated against."""

    width: int
    height: int
    dpi: int


class WindowsBackend(Protocol):
    def find_window(self, process_name: str, title_contains: str | None) -> WindowTarget: ...

    def list_process_windows(self, process_name: str) -> tuple[WindowTarget, ...]: ...

    def activate(self, target: WindowTarget) -> None: ...

    def is_foreground(self, target: WindowTarget) -> bool: ...

    def window_bounds(self, target: WindowTarget) -> ElementBounds: ...

    def locate_control(self, target: WindowTarget, locator: ControlLocator) -> ElementBounds: ...

    def display_profile(self) -> DisplayProfile: ...

    def cursor_position(self) -> ScreenPoint: ...

    def mouse_move(self, point: ScreenPoint) -> None: ...

    def mouse_click(
        self,
        point: ScreenPoint,
        *,
        button: MouseButton,
        click_count: int,
    ) -> None: ...

    def mouse_scroll(self, point: ScreenPoint, *, vertical_delta: int) -> None: ...

    def mouse_drag(self, start: ScreenPoint, end: ScreenPoint, *, button: MouseButton) -> None: ...

    def set_clipboard_text(self, text: str) -> None: ...

    def send_keys(self, keys: str) -> None: ...

    def send_chat_text(self, target: WindowTarget, text: str) -> None: ...

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
        wechat_process_name: str = "WeChat.exe",
        coordinate_mouse_profile: DisplayProfile | None = None,
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
        if coordinate_mouse_profile is not None and (
            coordinate_mouse_profile.width < 1
            or coordinate_mouse_profile.height < 1
            or coordinate_mouse_profile.dpi < 1
        ):
            raise ValueError("Coordinate mouse profile must use positive values")
        self._backend = backend
        self._allowed_processes = frozenset(
            normalize_process_name(name) for name in allowed_processes
        )
        self._artifact_directory = artifact_directory
        self._wechat_process_name = normalize_process_name(wechat_process_name)
        # Coordinate clicks stay disabled unless a calibrated display profile is configured.
        self._coordinate_mouse_profile = coordinate_mouse_profile
        self._state_lock = Lock()
        self._active_target: WindowTarget | None = None
        self._pinned_target: WindowTarget | None = None

    def pin_target(self, target: WindowTarget) -> None:
        """Pin a window resolved outside a command, for fixtures that launch the target app.

        The pinned window is re-validated against the process window list on every use, so a
        closed or replaced window fails with ``TARGET_WINDOW_LOST`` instead of silently acting
        on a different window.
        """

        with self._state_lock:
            self._pinned_target = target

    def clear_pinned_target(self) -> None:
        with self._state_lock:
            self._pinned_target = None

    async def execute(
        self,
        command: DesktopCommandPayload,
        cancellation: Event,
    ) -> CommandExecutionResult:
        if cancellation.is_set():
            return CommandExecutionResult.rejected("TASK_CANCELLED")

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
            requested_process = self._require_allowed_process(command.arguments.process_name)
            target = self._resolve_window(
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

        if isinstance(command, WeChatSendTextPayload):
            if self._wechat_process_name not in self._allowed_processes:
                raise DesktopActionFailure("POLICY_DENIED")
            target = self._backend.find_window(self._wechat_process_name, None)
            _raise_if_cancelled(cancellation)
            self._backend.activate(target)
            if not self._backend.is_foreground(target):
                raise DesktopActionFailure("TARGET_WINDOW_MISMATCH")
            _raise_if_cancelled(cancellation)
            self._backend.send_chat_text(target, command.arguments.text)
            with self._state_lock:
                self._active_target = target
            return CommandExecutionResult.succeeded()

        if isinstance(command, (MouseMovePayload, MouseClickPayload, MouseScrollPayload)):
            target = self._resolve_mouse_window(command.arguments.target)
            point = self._locate_target_point(target, command.arguments.target, cancellation)
            _raise_if_cancelled(cancellation)
            if isinstance(command, MouseMovePayload):
                self._backend.mouse_move(point)
            elif isinstance(command, MouseClickPayload):
                self._backend.mouse_click(
                    point,
                    button=command.arguments.button,
                    click_count=command.arguments.click_count,
                )
            else:
                self._backend.mouse_scroll(point, vertical_delta=command.arguments.vertical_delta)
            return CommandExecutionResult.succeeded()

        if isinstance(command, MouseDragPayload):
            drag = command.arguments
            target = self._resolve_mouse_window(drag.from_control)
            destination_process = self._require_allowed_process(drag.to_control.process_name)
            if destination_process != target.process_name:
                # Dragging across applications risks dropping data into an unintended window.
                raise DesktopActionFailure("POLICY_DENIED")
            start = self._locate_target_point(target, drag.from_control, cancellation)
            end = self._locate_target_point(target, drag.to_control, cancellation)
            _raise_if_cancelled(cancellation)
            self._backend.mouse_drag(start, end, button=drag.button)
            return CommandExecutionResult.succeeded()

        if isinstance(command, MouseClickPositionPayload):
            return self._execute_click_position(command, cancellation)

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

    def _resolve_window(self, process_name: str, title_contains: str | None) -> WindowTarget:
        with self._state_lock:
            pinned = self._pinned_target
        if pinned is not None and pinned.process_name == process_name:
            for live in self._backend.list_process_windows(process_name):
                if live.handle == pinned.handle and live.process_id == pinned.process_id:
                    # Re-read the window so the newest title is used by later steps.
                    return live
            raise DesktopActionFailure("TARGET_WINDOW_LOST")
        return self._backend.find_window(process_name, title_contains)

    def _require_foreground_target(self) -> WindowTarget:
        with self._state_lock:
            target = self._active_target
        if target is None or not self._backend.is_foreground(target):
            raise DesktopActionFailure("TARGET_WINDOW_MISMATCH")
        return target

    def _require_allowed_process(self, process_name: str) -> str:
        if PureWindowsPath(process_name).name != process_name:
            raise DesktopActionFailure("POLICY_DENIED")
        requested_process = normalize_process_name(process_name)
        if requested_process not in self._allowed_processes:
            raise DesktopActionFailure("POLICY_DENIED")
        return requested_process

    def _resolve_mouse_window(self, selector: WindowSelector) -> WindowTarget:
        """Activate and foreground-check the allowlisted window a pointer action targets.

        Real mouse input is delivered to whatever window is under the cursor, so the target
        window must be the foreground window before any button event is injected.
        """

        requested_process = self._require_allowed_process(selector.process_name)
        target = self._resolve_window(requested_process, selector.title_contains)
        self._backend.activate(target)
        if not self._backend.is_foreground(target):
            raise DesktopActionFailure("TARGET_WINDOW_MISMATCH")
        with self._state_lock:
            self._active_target = target
        return target

    def _locate_target_point(
        self,
        target: WindowTarget,
        locator: ControlLocator,
        cancellation: Event,
    ) -> ScreenPoint:
        bounds = self._backend.locate_control(target, locator)
        point = ScreenPoint(
            x=bounds.left
            + (locator.offset_x if locator.offset_x is not None else bounds.width // 2),
            y=bounds.top
            + (locator.offset_y if locator.offset_y is not None else bounds.height // 2),
        )
        _raise_if_cancelled(cancellation)
        # A control that was scrolled out of view reports coordinates outside its window;
        # clicking them would land on a different application.
        if not self._backend.window_bounds(target).contains(point):
            raise DesktopActionFailure("UI_ELEMENT_OUT_OF_VIEW")
        return point

    def _execute_click_position(
        self,
        command: MouseClickPositionPayload,
        cancellation: Event,
    ) -> CommandExecutionResult:
        profile = self._coordinate_mouse_profile
        if profile is None:
            raise DesktopActionFailure("POLICY_DENIED")
        arguments = command.arguments
        target = self._resolve_mouse_window(arguments.target)
        live_profile = self._backend.display_profile()
        if (live_profile.width, live_profile.height, live_profile.dpi) != (
            profile.width,
            profile.height,
            profile.dpi,
        ):
            raise DesktopActionFailure("DISPLAY_PROFILE_MISMATCH")
        bounds = self._backend.window_bounds(target)
        if arguments.x >= bounds.width or arguments.y >= bounds.height:
            raise DesktopActionFailure("COORDINATE_OUT_OF_WINDOW")
        point = ScreenPoint(x=bounds.left + arguments.x, y=bounds.top + arguments.y)
        _raise_if_cancelled(cancellation)
        self._backend.mouse_click(
            point,
            button=arguments.button,
            click_count=arguments.click_count,
        )
        return CommandExecutionResult.succeeded()


def create_windows_executor(
    *,
    allowed_processes: frozenset[str],
    artifact_directory: Path,
    wechat_process_name: str = "WeChat.exe",
    coordinate_mouse_profile: DisplayProfile | None = None,
) -> WindowsDesktopActionExecutor:
    from .windows_backend import PywinautoWindowsBackend

    return WindowsDesktopActionExecutor(
        PywinautoWindowsBackend(),
        allowed_processes=allowed_processes,
        artifact_directory=artifact_directory,
        wechat_process_name=wechat_process_name,
        coordinate_mouse_profile=coordinate_mouse_profile,
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

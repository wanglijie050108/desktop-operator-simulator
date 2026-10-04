from __future__ import annotations

import json
import sys
from pathlib import Path
from threading import Event
from typing import Any
from uuid import uuid4

import pytest

from desktop_agent.execution import CommandExecutionResult
from desktop_agent.protocol import (
    CommandOutcome,
    DesktopCommand,
    MouseButton,
    parse_server_message,
)
from desktop_agent.windows_executor import (
    DesktopActionFailure,
    DisplayProfile,
    ElementBounds,
    ScreenPoint,
    WindowsBackend,
    WindowsDesktopActionExecutor,
    WindowTarget,
    create_windows_executor,
    normalize_process_name,
)

TARGET = WindowTarget(
    handle=123,
    process_id=456,
    process_name="notepad",
    title="Untitled - Notepad",
)
TARGET_WINDOW = ElementBounds(left=100, top=200, width=913, height=583)
TARGET_CONTROL = ElementBounds(left=140, top=280, width=400, height=300)
DISPLAY_PROFILE = DisplayProfile(width=1920, height=1080, dpi=96)


def payload(action: str, arguments: dict[str, Any]) -> Any:
    parsed = parse_server_message(
        json.dumps(
            {
                "schemaVersion": "1.0",
                "type": "desktop.command",
                "messageId": str(uuid4()),
                "timestamp": "2026-09-28T04:00:00Z",
                "payload": {
                    "commandId": str(uuid4()),
                    "taskId": str(uuid4()),
                    "expiresAt": "2026-09-28T04:01:00Z",
                    "action": action,
                    "arguments": arguments,
                },
            }
        )
    )
    assert isinstance(parsed, DesktopCommand)
    return parsed.payload


class FakeWindowsBackend(WindowsBackend):
    def __init__(self) -> None:
        self.foreground = True
        self.find_error: Exception | None = None
        self.found_with: tuple[str, str | None] | None = None
        self.listed_with: str | None = None
        self.process_windows: tuple[WindowTarget, ...] = (TARGET,)
        self.activated: WindowTarget | None = None
        self.clipboard_text: str | None = None
        self.sent_keys: str | None = None
        self.sent_chat_text: tuple[WindowTarget, str] | None = None
        self.screenshot: tuple[WindowTarget, Path] | None = None
        self.release_count = 0
        self.window_rect = TARGET_WINDOW
        self.control_rect = TARGET_CONTROL
        self.locate_error: Exception | None = None
        self.located_with: tuple[WindowTarget, Any] | None = None
        self.profile = DISPLAY_PROFILE
        self.cursor = ScreenPoint(x=0, y=0)
        self.moves: list[ScreenPoint] = []
        self.clicks: list[tuple[ScreenPoint, Any, int]] = []
        self.scrolls: list[tuple[ScreenPoint, int]] = []
        self.drags: list[tuple[ScreenPoint, ScreenPoint, Any]] = []

    def find_window(self, process_name: str, title_contains: str | None) -> WindowTarget:
        self.found_with = (process_name, title_contains)
        if self.find_error is not None:
            raise self.find_error
        return TARGET

    def list_process_windows(self, process_name: str) -> tuple[WindowTarget, ...]:
        self.listed_with = process_name
        return self.process_windows

    def activate(self, target: WindowTarget) -> None:
        self.activated = target

    def is_foreground(self, target: WindowTarget) -> bool:
        return self.foreground and target == TARGET

    def window_bounds(self, target: WindowTarget) -> ElementBounds:
        return self.window_rect

    def locate_control(self, target: WindowTarget, locator: Any) -> ElementBounds:
        self.located_with = (target, locator)
        if self.locate_error is not None:
            raise self.locate_error
        return self.control_rect

    def display_profile(self) -> DisplayProfile:
        return self.profile

    def cursor_position(self) -> ScreenPoint:
        return self.cursor

    def mouse_move(self, point: ScreenPoint) -> None:
        self.moves.append(point)
        self.cursor = point

    def mouse_click(self, point: ScreenPoint, *, button: Any, click_count: int) -> None:
        self.clicks.append((point, button, click_count))
        self.cursor = point

    def mouse_scroll(self, point: ScreenPoint, *, vertical_delta: int) -> None:
        self.scrolls.append((point, vertical_delta))
        self.cursor = point

    def mouse_drag(self, start: ScreenPoint, end: ScreenPoint, *, button: Any) -> None:
        self.drags.append((start, end, button))
        self.cursor = end

    def set_clipboard_text(self, text: str) -> None:
        self.clipboard_text = text

    def send_keys(self, keys: str) -> None:
        self.sent_keys = keys

    def send_chat_text(self, target: WindowTarget, text: str) -> None:
        self.sent_chat_text = (target, text)

    def capture_window(self, target: WindowTarget, destination: Path) -> None:
        self.screenshot = (target, destination)

    def release_inputs(self) -> None:
        self.release_count += 1


def executor(backend: WindowsBackend, artifact_directory: Path) -> WindowsDesktopActionExecutor:
    return WindowsDesktopActionExecutor(
        backend,
        allowed_processes=frozenset({"Notepad.exe"}),
        artifact_directory=artifact_directory,
    )


def mouse_executor(
    backend: WindowsBackend,
    artifact_directory: Path,
    profile: DisplayProfile | None = None,
) -> WindowsDesktopActionExecutor:
    return WindowsDesktopActionExecutor(
        backend,
        allowed_processes=frozenset({"Notepad.exe"}),
        artifact_directory=artifact_directory,
        coordinate_mouse_profile=profile,
    )


def wechat_executor(
    backend: WindowsBackend, artifact_directory: Path
) -> WindowsDesktopActionExecutor:
    return WindowsDesktopActionExecutor(
        backend,
        allowed_processes=frozenset({"WeChat.exe"}),
        artifact_directory=artifact_directory,
        wechat_process_name="WeChat.exe",
    )


@pytest.mark.asyncio
async def test_activates_single_allowlisted_window(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = executor(backend, tmp_path)

    result = await desktop_executor.execute(
        payload(
            "WINDOW_ACTIVATE",
            {"processName": "NOTEPAD.EXE", "titleContains": "Notepad"},
        ),
        Event(),
    )

    assert result.outcome is CommandOutcome.SUCCEEDED
    assert backend.found_with == ("notepad", "Notepad")
    assert backend.activated == TARGET


@pytest.mark.asyncio
async def test_pinned_window_is_used_instead_of_title_lookup(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = executor(backend, tmp_path)
    desktop_executor.pin_target(TARGET)

    result = await desktop_executor.execute(
        payload(
            "WINDOW_ACTIVATE",
            {"processName": "notepad.exe", "titleContains": "stale title"},
        ),
        Event(),
    )

    assert result.outcome is CommandOutcome.SUCCEEDED
    # A title that no longer matches must not matter while the pinned window is alive.
    assert backend.found_with is None
    assert backend.listed_with == "notepad"
    assert backend.activated == TARGET


@pytest.mark.asyncio
async def test_pinned_window_disappearing_fails_closed(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    backend.process_windows = ()
    desktop_executor = executor(backend, tmp_path)
    desktop_executor.pin_target(TARGET)

    result = await desktop_executor.execute(
        payload("WINDOW_ACTIVATE", {"processName": "notepad.exe"}),
        Event(),
    )

    assert result == CommandExecutionResult.failed("TARGET_WINDOW_LOST")
    assert backend.activated is None


@pytest.mark.asyncio
async def test_pinned_window_is_ignored_for_another_process(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = executor(backend, tmp_path)
    desktop_executor.pin_target(
        WindowTarget(handle=999, process_id=888, process_name="wechat", title="WeChat")
    )

    result = await desktop_executor.execute(
        payload("WINDOW_ACTIVATE", {"processName": "notepad.exe", "titleContains": "Notepad"}),
        Event(),
    )

    assert result.outcome is CommandOutcome.SUCCEEDED
    assert backend.found_with == ("notepad", "Notepad")


@pytest.mark.asyncio
async def test_rejects_process_outside_allowlist(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = executor(backend, tmp_path)

    result = await desktop_executor.execute(
        payload("WINDOW_ACTIVATE", {"processName": "cmd.exe"}),
        Event(),
    )
    path_result = await desktop_executor.execute(
        payload("WINDOW_ACTIVATE", {"processName": r"C:\Windows\notepad.exe"}),
        Event(),
    )

    assert result == CommandExecutionResult.rejected("POLICY_DENIED")
    assert path_result == CommandExecutionResult.rejected("POLICY_DENIED")
    assert backend.found_with is None


@pytest.mark.asyncio
async def test_requires_foreground_target_before_desktop_actions(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = executor(backend, tmp_path)

    result = await desktop_executor.execute(
        payload("CLIPBOARD_SET_TEXT", {"text": "safe fixture"}),
        Event(),
    )

    assert result == CommandExecutionResult.failed("TARGET_WINDOW_MISMATCH")
    assert backend.clipboard_text is None


@pytest.mark.asyncio
async def test_executes_clipboard_key_chord_and_screenshot_for_foreground_target(
    tmp_path: Path,
) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = executor(backend, tmp_path)
    activation = await desktop_executor.execute(
        payload("WINDOW_ACTIVATE", {"processName": "notepad"}),
        Event(),
    )

    clipboard = await desktop_executor.execute(
        payload("CLIPBOARD_SET_TEXT", {"text": "safe fixture"}),
        Event(),
    )
    chord = await desktop_executor.execute(
        payload("INPUT_KEY_CHORD", {"keys": ["CTRL", "SHIFT", "A"]}),
        Event(),
    )
    screenshot_payload = payload("TAKE_SCREENSHOT", {"artifactName": "notepad-window"})
    screenshot = await desktop_executor.execute(screenshot_payload, Event())

    assert activation.outcome is CommandOutcome.SUCCEEDED
    assert clipboard.outcome is CommandOutcome.SUCCEEDED
    assert chord.outcome is CommandOutcome.SUCCEEDED
    assert screenshot.outcome is CommandOutcome.SUCCEEDED
    assert backend.clipboard_text == "safe fixture"
    assert backend.sent_keys == "^+a"
    assert backend.screenshot is not None
    assert backend.screenshot[0] == TARGET
    assert backend.screenshot[1] == (
        tmp_path / f"notepad-window-{screenshot_payload.command_id.hex}.png"
    )


@pytest.mark.asyncio
async def test_rechecks_foreground_after_action(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = executor(backend, tmp_path)
    await desktop_executor.execute(
        payload("WINDOW_ACTIVATE", {"processName": "notepad"}),
        Event(),
    )
    backend.foreground = False

    result = await desktop_executor.execute(
        payload("INPUT_KEY_CHORD", {"keys": ["CTRL", "C"]}),
        Event(),
    )

    assert result == CommandExecutionResult.failed("TARGET_WINDOW_MISMATCH")
    assert backend.sent_keys is None


@pytest.mark.asyncio
async def test_rejects_modifier_only_key_chord(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = executor(backend, tmp_path)
    await desktop_executor.execute(
        payload("WINDOW_ACTIVATE", {"processName": "notepad"}),
        Event(),
    )

    result = await desktop_executor.execute(
        payload("INPUT_KEY_CHORD", {"keys": ["CTRL", "ALT"]}),
        Event(),
    )

    assert result == CommandExecutionResult.rejected("INVALID_ARGUMENTS")


@pytest.mark.asyncio
async def test_maps_backend_failures_and_unexpected_errors(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = executor(backend, tmp_path)
    backend.find_error = DesktopActionFailure("TARGET_APP_NOT_FOUND")
    missing = await desktop_executor.execute(
        payload("WINDOW_ACTIVATE", {"processName": "notepad"}),
        Event(),
    )
    backend.find_error = RuntimeError("sensitive backend detail")
    unexpected = await desktop_executor.execute(
        payload("WINDOW_ACTIVATE", {"processName": "notepad"}),
        Event(),
    )

    assert missing == CommandExecutionResult.failed("TARGET_APP_NOT_FOUND")
    assert unexpected == CommandExecutionResult.failed("DESKTOP_ACTION_FAILED")


@pytest.mark.asyncio
async def test_cancellation_and_emergency_stop_are_fail_closed(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = executor(backend, tmp_path)
    cancellation = Event()
    cancellation.set()

    cancelled = await desktop_executor.execute(
        payload("WINDOW_ACTIVATE", {"processName": "notepad"}),
        cancellation,
    )
    send_blocked = await desktop_executor.execute(
        payload("WECHAT_SEND_TEXT", {"conversationId": "x", "text": "safe fixture"}),
        Event(),
    )
    await desktop_executor.emergency_stop()
    after_stop = await desktop_executor.execute(
        payload("CLIPBOARD_SET_TEXT", {"text": "safe fixture"}),
        Event(),
    )

    assert cancelled == CommandExecutionResult.rejected("TASK_CANCELLED")
    assert send_blocked == CommandExecutionResult.rejected("POLICY_DENIED")
    assert backend.release_count == 1
    assert after_stop == CommandExecutionResult.failed("TARGET_WINDOW_MISMATCH")


def test_process_name_normalization_and_platform_guard(tmp_path: Path) -> None:
    assert normalize_process_name(r"C:\Windows\System32\NOTEPAD.EXE") == "notepad"
    with pytest.raises(ValueError, match="allowed process"):
        WindowsDesktopActionExecutor(
            FakeWindowsBackend(),
            allowed_processes=frozenset(),
            artifact_directory=tmp_path,
        )
    with pytest.raises(ValueError, match="Invalid allowed process"):
        WindowsDesktopActionExecutor(
            FakeWindowsBackend(),
            allowed_processes=frozenset({r"C:\Windows\notepad.exe"}),
            artifact_directory=tmp_path,
        )

    if sys.platform != "win32":
        with pytest.raises(ValueError, match="only available on Windows"):
            create_windows_executor(
                allowed_processes=frozenset({"notepad.exe"}),
                artifact_directory=tmp_path,
            )


@pytest.mark.asyncio
async def test_sends_wechat_text_after_activating_wechat_window(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = wechat_executor(backend, tmp_path)

    result = await desktop_executor.execute(
        payload(
            "WECHAT_SEND_TEXT",
            {"conversationId": "x", "text": "safe reply fixture"},
        ),
        Event(),
    )

    assert result.outcome is CommandOutcome.SUCCEEDED
    assert backend.found_with == ("wechat", None)
    assert backend.activated == TARGET
    assert backend.sent_chat_text == (TARGET, "safe reply fixture")


@pytest.mark.asyncio
async def test_wechat_send_requires_foreground_after_activation(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = wechat_executor(backend, tmp_path)
    backend.foreground = False

    result = await desktop_executor.execute(
        payload("WECHAT_SEND_TEXT", {"conversationId": "x", "text": "safe reply fixture"}),
        Event(),
    )

    assert result == CommandExecutionResult.failed("TARGET_WINDOW_MISMATCH")
    assert backend.sent_chat_text is None


@pytest.mark.asyncio
async def test_mouse_move_targets_the_located_element_centre(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = mouse_executor(backend, tmp_path)

    result = await desktop_executor.execute(
        payload(
            "MOUSE_MOVE", {"target": {"processName": "notepad.exe", "controlType": "Document"}}
        ),
        Event(),
    )

    assert result.outcome is CommandOutcome.SUCCEEDED
    assert backend.activated == TARGET
    assert backend.moves == [ScreenPoint(x=340, y=430)]
    assert backend.clicks == []


@pytest.mark.asyncio
async def test_mouse_click_uses_element_relative_offsets(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = mouse_executor(backend, tmp_path)

    result = await desktop_executor.execute(
        payload(
            "MOUSE_CLICK",
            {
                "target": {
                    "processName": "notepad.exe",
                    "controlType": "Document",
                    "offsetX": 4,
                    "offsetY": 8,
                },
                "button": "RIGHT",
                "clickCount": 2,
            },
        ),
        Event(),
    )

    assert result.outcome is CommandOutcome.SUCCEEDED
    assert backend.clicks == [(ScreenPoint(x=144, y=288), MouseButton.RIGHT, 2)]


@pytest.mark.asyncio
async def test_mouse_scroll_and_drag_use_relative_points(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = mouse_executor(backend, tmp_path)
    target = {"processName": "notepad.exe", "controlType": "Document"}

    scroll = await desktop_executor.execute(
        payload("MOUSE_SCROLL", {"target": target, "verticalDelta": -3}),
        Event(),
    )
    drag = await desktop_executor.execute(
        payload(
            "MOUSE_DRAG",
            {
                "from": {**target, "offsetX": 10, "offsetY": 8},
                "to": {**target, "offsetX": 110, "offsetY": 8},
            },
        ),
        Event(),
    )

    assert scroll.outcome is CommandOutcome.SUCCEEDED
    assert drag.outcome is CommandOutcome.SUCCEEDED
    assert backend.scrolls == [(ScreenPoint(x=340, y=430), -3)]
    assert backend.drags == [
        (ScreenPoint(x=150, y=288), ScreenPoint(x=250, y=288), MouseButton.LEFT)
    ]


@pytest.mark.asyncio
async def test_mouse_actions_deny_processes_outside_the_allowlist(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = mouse_executor(backend, tmp_path)
    target = {"processName": "cmd.exe", "controlType": "Document"}

    denied = await desktop_executor.execute(payload("MOUSE_CLICK", {"target": target}), Event())
    path_denied = await desktop_executor.execute(
        payload("MOUSE_CLICK", {"target": {**target, "processName": r"C:\Windows\notepad.exe"}}),
        Event(),
    )
    drag_denied = await desktop_executor.execute(
        payload(
            "MOUSE_DRAG",
            {"from": target, "to": {**target, "processName": "explorer.exe"}},
        ),
        Event(),
    )

    assert denied == CommandExecutionResult.rejected("POLICY_DENIED")
    assert path_denied == CommandExecutionResult.rejected("POLICY_DENIED")
    assert drag_denied == CommandExecutionResult.rejected("POLICY_DENIED")
    assert backend.clicks == []
    assert backend.activated is None


@pytest.mark.asyncio
async def test_mouse_drag_rejects_a_second_process(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = mouse_executor(backend, tmp_path)

    result = await desktop_executor.execute(
        payload(
            "MOUSE_DRAG",
            {
                "from": {"processName": "notepad.exe"},
                "to": {"processName": r"C:\Windows\System32\notepad.exe"},
            },
        ),
        Event(),
    )

    assert result == CommandExecutionResult.rejected("POLICY_DENIED")
    assert backend.drags == []


@pytest.mark.asyncio
async def test_mouse_requires_a_foreground_target(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = mouse_executor(backend, tmp_path)
    backend.foreground = False

    result = await desktop_executor.execute(
        payload("MOUSE_CLICK", {"target": {"processName": "notepad.exe"}}),
        Event(),
    )

    assert result == CommandExecutionResult.failed("TARGET_WINDOW_MISMATCH")
    assert backend.clicks == []
    assert backend.located_with is None


@pytest.mark.asyncio
async def test_mouse_rejects_points_outside_the_target_window(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = mouse_executor(backend, tmp_path)
    # A control scrolled out of view reports a rectangle outside the window rectangle.
    backend.control_rect = ElementBounds(left=1400, top=1200, width=200, height=100)

    result = await desktop_executor.execute(
        payload("MOUSE_CLICK", {"target": {"processName": "notepad.exe"}}),
        Event(),
    )

    assert result == CommandExecutionResult.failed("UI_ELEMENT_OUT_OF_VIEW")
    assert backend.clicks == []


@pytest.mark.asyncio
async def test_mouse_propagates_locator_failures(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = mouse_executor(backend, tmp_path)
    backend.locate_error = DesktopActionFailure("UI_ELEMENT_AMBIGUOUS")

    result = await desktop_executor.execute(
        payload("MOUSE_MOVE", {"target": {"processName": "notepad.exe", "name": "Duplicate"}}),
        Event(),
    )

    assert result == CommandExecutionResult.failed("UI_ELEMENT_AMBIGUOUS")
    assert backend.moves == []


@pytest.mark.asyncio
async def test_mouse_actions_stop_before_input_when_cancelled(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = mouse_executor(backend, tmp_path)
    cancellation = Event()

    def cancel_before_input(target: WindowTarget, locator: Any) -> ElementBounds:
        cancellation.set()
        return TARGET_CONTROL

    backend.locate_control = cancel_before_input  # type: ignore[method-assign]

    result = await desktop_executor.execute(
        payload("MOUSE_CLICK", {"target": {"processName": "notepad.exe"}}),
        cancellation,
    )

    assert result == CommandExecutionResult.rejected("TASK_CANCELLED")
    assert backend.clicks == []


@pytest.mark.asyncio
async def test_coordinate_clicks_are_disabled_without_a_profile(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = mouse_executor(backend, tmp_path)

    result = await desktop_executor.execute(
        payload(
            "MOUSE_CLICK_POSITION",
            {"target": {"processName": "notepad.exe"}, "x": 10, "y": 20},
        ),
        Event(),
    )

    assert result == CommandExecutionResult.rejected("POLICY_DENIED")
    assert backend.clicks == []


@pytest.mark.asyncio
async def test_coordinate_clicks_require_the_calibrated_display_profile(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = mouse_executor(backend, tmp_path, DISPLAY_PROFILE)
    backend.profile = DisplayProfile(width=1280, height=720, dpi=144)

    result = await desktop_executor.execute(
        payload(
            "MOUSE_CLICK_POSITION",
            {"target": {"processName": "notepad.exe"}, "x": 10, "y": 20},
        ),
        Event(),
    )

    assert result == CommandExecutionResult.failed("DISPLAY_PROFILE_MISMATCH")
    assert backend.clicks == []


@pytest.mark.asyncio
async def test_coordinate_clicks_reject_points_outside_the_window(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = mouse_executor(backend, tmp_path, DISPLAY_PROFILE)

    result = await desktop_executor.execute(
        payload(
            "MOUSE_CLICK_POSITION",
            {"target": {"processName": "notepad.exe"}, "x": 913, "y": 10},
        ),
        Event(),
    )

    assert result == CommandExecutionResult.failed("COORDINATE_OUT_OF_WINDOW")
    assert backend.clicks == []


@pytest.mark.asyncio
async def test_coordinate_click_is_window_relative_and_foreground_checked(tmp_path: Path) -> None:
    backend = FakeWindowsBackend()
    desktop_executor = mouse_executor(backend, tmp_path, DISPLAY_PROFILE)

    result = await desktop_executor.execute(
        payload(
            "MOUSE_CLICK_POSITION",
            {"target": {"processName": "notepad.exe"}, "x": 12, "y": 34, "button": "MIDDLE"},
        ),
        Event(),
    )

    assert result.outcome is CommandOutcome.SUCCEEDED
    assert backend.activated == TARGET
    assert backend.clicks == [(ScreenPoint(x=112, y=234), MouseButton.MIDDLE, 1)]


def test_executor_rejects_an_invalid_coordinate_mouse_profile(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="positive values"):
        mouse_executor(FakeWindowsBackend(), tmp_path, DisplayProfile(width=0, height=1080, dpi=96))

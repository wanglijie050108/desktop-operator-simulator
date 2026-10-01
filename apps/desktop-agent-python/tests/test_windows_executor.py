from __future__ import annotations

import json
import sys
from pathlib import Path
from threading import Event
from typing import Any
from uuid import uuid4

import pytest

from desktop_agent.execution import CommandExecutionResult
from desktop_agent.protocol import CommandOutcome, DesktopCommand, parse_server_message
from desktop_agent.windows_executor import (
    DesktopActionFailure,
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
        self.activated: WindowTarget | None = None
        self.clipboard_text: str | None = None
        self.sent_keys: str | None = None
        self.sent_chat_text: tuple[WindowTarget, str] | None = None
        self.screenshot: tuple[WindowTarget, Path] | None = None
        self.release_count = 0

    def find_window(self, process_name: str, title_contains: str | None) -> WindowTarget:
        self.found_with = (process_name, title_contains)
        if self.find_error is not None:
            raise self.find_error
        return TARGET

    def activate(self, target: WindowTarget) -> None:
        self.activated = target

    def is_foreground(self, target: WindowTarget) -> bool:
        return self.foreground and target == TARGET

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

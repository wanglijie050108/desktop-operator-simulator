"""Concrete pywinauto backend; this module is imported only on Windows."""

from __future__ import annotations

import ctypes
import importlib
import platform
import subprocess
import sys
import time
from collections import deque
from pathlib import Path
from typing import Any

from .uia_inspection import RawUiaControlNode
from .windows_executor import DesktopActionFailure, WindowTarget, normalize_process_name

NOTEPAD_PROCESS_NAME = "notepad.exe"
NEW_WINDOW_TIMEOUT_SECONDS = 15.0
NEW_WINDOW_POLL_INTERVAL_SECONDS = 0.25


class PywinautoWindowsBackend:
    def __init__(self) -> None:
        if sys.platform != "win32":
            raise ValueError("Windows automation is only available on Windows")

        self._pywinauto: Any = importlib.import_module("pywinauto")
        self._application: Any = importlib.import_module("pywinauto.application")
        self._keyboard: Any = importlib.import_module("pywinauto.keyboard")
        self._win32clipboard: Any = importlib.import_module("win32clipboard")
        self._win32con: Any = importlib.import_module("win32con")
        self._win32gui: Any = importlib.import_module("win32gui")
        self._win32process: Any = importlib.import_module("win32process")

    def start_notepad(self) -> str:
        """Launch notepad.exe and return the title of the window this call created.

        Windows 11 Notepad hosts every document window inside a single process, so "the only
        visible window of notepad" is not a usable locator. The launched window is identified
        by diffing the process windows around the launch, and it never falls back to a window
        that already existed: targeting an unrelated document could type over its content.
        """

        existing_handles = {target.handle for target in self._process_windows(NOTEPAD_PROCESS_NAME)}
        subprocess.Popen([NOTEPAD_PROCESS_NAME])  # noqa: S603 - fixed literal
        deadline = time.monotonic() + NEW_WINDOW_TIMEOUT_SECONDS
        while True:
            created = [
                target
                for target in self._process_windows(NOTEPAD_PROCESS_NAME)
                if target.handle not in existing_handles
            ]
            if len(created) == 1:
                return created[0].title
            if len(created) > 1:
                raise DesktopActionFailure("NOTEPAD_WINDOW_AMBIGUOUS")
            if time.monotonic() >= deadline:
                raise DesktopActionFailure("NOTEPAD_WINDOW_NOT_FOUND")
            time.sleep(NEW_WINDOW_POLL_INTERVAL_SECONDS)

    def find_window(self, process_name: str, title_contains: str | None) -> WindowTarget:
        targets = self._process_windows(process_name)
        if not targets:
            raise DesktopActionFailure("TARGET_APP_NOT_FOUND")

        if title_contains is not None:
            expected_title = title_contains.casefold()
            targets = [target for target in targets if expected_title in target.title.casefold()]
            if not targets:
                raise DesktopActionFailure("TARGET_WINDOW_NOT_FOUND")

        if len(targets) != 1:
            raise DesktopActionFailure("MULTIPLE_TARGET_WINDOWS")
        return targets[0]

    def _process_windows(self, process_name: str) -> list[WindowTarget]:
        expected_process = normalize_process_name(process_name)
        process_windows: list[WindowTarget] = []

        for window in self._pywinauto.Desktop(backend="uia").windows(
            visible_only=True,
            enabled_only=True,
        ):
            try:
                process_id = int(window.element_info.process_id)
                executable = str(self._application.process_module(process_id))
                actual_process = normalize_process_name(executable)
                if actual_process != expected_process:
                    continue
                process_windows.append(
                    WindowTarget(
                        handle=int(window.handle),
                        process_id=process_id,
                        process_name=actual_process,
                        title=str(window.window_text()),
                    )
                )
            except Exception:
                # Some system windows cannot expose process metadata to a standard user.
                continue

        return process_windows

    def activate(self, target: WindowTarget) -> None:
        self._window(target).set_focus()

    def is_foreground(self, target: WindowTarget) -> bool:
        foreground_handle = int(self._win32gui.GetForegroundWindow())
        if foreground_handle != target.handle:
            return False
        _, process_id = self._win32process.GetWindowThreadProcessId(foreground_handle)
        return int(process_id) == target.process_id

    def set_clipboard_text(self, text: str) -> None:
        self._win32clipboard.OpenClipboard()
        try:
            self._win32clipboard.EmptyClipboard()
            self._win32clipboard.SetClipboardText(text, self._win32con.CF_UNICODETEXT)
        finally:
            self._win32clipboard.CloseClipboard()

    def get_clipboard_text(self) -> str:
        self._win32clipboard.OpenClipboard()
        try:
            return str(self._win32clipboard.GetClipboardData(self._win32con.CF_UNICODETEXT))
        finally:
            self._win32clipboard.CloseClipboard()

    def send_keys(self, keys: str) -> None:
        self._keyboard.send_keys(keys, pause=0.05, vk_packet=False)

    def capture_window(self, target: WindowTarget, destination: Path) -> None:
        self._window(target).capture_as_image().save(str(destination), format="PNG")

    def read_document_text(self, target: WindowTarget) -> str:
        window = self._window(target)
        controls = window.descendants(control_type="Document")
        if not controls:
            controls = window.descendants(control_type="Edit")
        if len(controls) != 1:
            raise DesktopActionFailure("UI_ELEMENT_NOT_FOUND")
        return str(controls[0].window_text())

    def send_chat_text(self, target: WindowTarget, text: str) -> None:
        # Locator heuristic: the chat input box is the lowest Edit control in the WeChat
        # window, falling back to Document controls. Re-validate against the target build.
        window = self._window(target)
        input_controls = window.descendants(control_type="Edit") or window.descendants(
            control_type="Document"
        )
        if not input_controls:
            raise DesktopActionFailure("UI_ELEMENT_NOT_FOUND")
        input_control = input_controls[-1]
        input_control.set_focus()
        # Paste through the clipboard so that arbitrary text (Chinese, punctuation, symbols)
        # is delivered verbatim instead of being interpreted as key chords.
        self.set_clipboard_text(text)
        self._keyboard.send_keys("^v", pause=0.02, vk_packet=False)
        self._keyboard.send_keys("{ENTER}", pause=0.02, vk_packet=False)

    def collect_control_tree(
        self,
        target: WindowTarget,
        maximum_nodes: int,
    ) -> tuple[list[RawUiaControlNode], bool]:
        if maximum_nodes < 1:
            raise ValueError("Maximum UIA node count must be positive")
        pending: deque[tuple[Any, int]] = deque([(self._window(target), 0)])
        nodes: list[RawUiaControlNode] = []
        had_errors = False

        while pending and len(nodes) < maximum_nodes:
            wrapper, depth = pending.popleft()
            try:
                info = wrapper.element_info
                nodes.append(
                    RawUiaControlNode(
                        depth=depth,
                        control_type=str(info.control_type or ""),
                        class_name=str(info.class_name or ""),
                        automation_id=str(info.automation_id or ""),
                        name=str(info.name or ""),
                        enabled=bool(wrapper.is_enabled()),
                        visible=bool(wrapper.is_visible()),
                    )
                )
                pending.extend((child, depth + 1) for child in wrapper.children())
            except Exception:
                had_errors = True
                continue

        if not nodes:
            raise DesktopActionFailure("UI_ELEMENT_NOT_FOUND")
        return nodes, bool(pending) or had_errors

    def environment_metadata(self) -> dict[str, str | int]:
        user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        return {
            "os": platform.platform(),
            "python": platform.python_version(),
            "pywinauto": str(self._pywinauto.__version__),
            "screenWidth": int(user32.GetSystemMetrics(0)),
            "screenHeight": int(user32.GetSystemMetrics(1)),
            "dpi": int(user32.GetDpiForSystem()),
        }

    def release_inputs(self) -> None:
        user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        key_event_up = 0x0002
        for virtual_key in (0x10, 0x11, 0x12, 0x5B, 0x5C):
            user32.keybd_event(virtual_key, 0, key_event_up, 0)

        mouse_events = (
            (0x0004, 0),
            (0x0010, 0),
            (0x0040, 0),
            (0x0100, 1),
            (0x0100, 2),
        )
        for flag, data in mouse_events:
            user32.mouse_event(flag, 0, 0, data, 0)

    def _window(self, target: WindowTarget) -> Any:
        return self._pywinauto.Desktop(backend="uia").window(handle=target.handle).wrapper_object()

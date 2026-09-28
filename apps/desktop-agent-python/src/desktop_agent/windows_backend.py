"""Concrete pywinauto backend; this module is imported only on Windows."""

from __future__ import annotations

import ctypes
import importlib
import sys
from pathlib import Path
from typing import Any

from .windows_executor import DesktopActionFailure, WindowTarget, normalize_process_name


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

    def find_window(self, process_name: str, title_contains: str | None) -> WindowTarget:
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

        if not process_windows:
            raise DesktopActionFailure("TARGET_APP_NOT_FOUND")

        title_matches = process_windows
        if title_contains is not None:
            expected_title = title_contains.casefold()
            title_matches = [
                target for target in process_windows if expected_title in target.title.casefold()
            ]
        if len(title_matches) != 1:
            raise DesktopActionFailure("TARGET_WINDOW_MISMATCH")
        return title_matches[0]

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

    def send_keys(self, keys: str) -> None:
        self._keyboard.send_keys(keys, pause=0.05, vk_packet=False)

    def capture_window(self, target: WindowTarget, destination: Path) -> None:
        self._window(target).capture_as_image().save(str(destination), format="PNG")

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

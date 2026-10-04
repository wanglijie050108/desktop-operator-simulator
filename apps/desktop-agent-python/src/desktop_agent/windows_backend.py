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
from threading import Lock
from typing import Any

from .protocol import ControlLocator, MouseButton
from .uia_inspection import RawUiaControlNode
from .windows_executor import (
    DesktopActionFailure,
    DisplayProfile,
    ElementBounds,
    ScreenPoint,
    WindowTarget,
    normalize_process_name,
)

NOTEPAD_PROCESS_NAME = "notepad.exe"
NEW_WINDOW_TIMEOUT_SECONDS = 15.0
NEW_WINDOW_POLL_INTERVAL_SECONDS = 0.25
# A newly launched WinUI document window can appear and then be merged into an existing
# instance as a tab, so one sighting is not enough to accept it as the run target.
NEW_WINDOW_STABLE_POLLS = 3

_MOUSE_BUTTON_NAMES = {
    MouseButton.LEFT: "left",
    MouseButton.RIGHT: "right",
    MouseButton.MIDDLE: "middle",
}
_MOUSE_UP_EVENTS = {
    "left": 0x0004,
    "right": 0x0010,
    "middle": 0x0020,
}
DRAG_STEP_COUNT = 3
DRAG_STEP_SECONDS = 0.02


class PywinautoWindowsBackend:
    def __init__(self) -> None:
        if sys.platform != "win32":
            raise ValueError("Windows automation is only available on Windows")

        self._pywinauto: Any = importlib.import_module("pywinauto")
        self._application: Any = importlib.import_module("pywinauto.application")
        self._keyboard: Any = importlib.import_module("pywinauto.keyboard")
        self._mouse: Any = importlib.import_module("pywinauto.mouse")
        self._win32clipboard: Any = importlib.import_module("win32clipboard")
        self._win32con: Any = importlib.import_module("win32con")
        self._win32gui: Any = importlib.import_module("win32gui")
        self._win32process: Any = importlib.import_module("win32process")
        self._input_lock = Lock()
        self._pressed_buttons: set[str] = set()

    def start_notepad(self) -> WindowTarget:
        """Launch notepad.exe and return the window this call created.

        Windows 11 Notepad hosts every document window inside a single process, can absorb a new
        document into an existing instance as a tab, and derives the window title from the
        document content that the run itself rewrites. Neither "the only visible window" nor "the
        first window that appears" nor a captured title is a usable locator, so the run requires
        a clean instance and returns the new window for handle-based targeting.
        """

        existing_handles = {target.handle for target in self._process_windows(NOTEPAD_PROCESS_NAME)}
        if existing_handles:
            raise DesktopActionFailure("NOTEPAD_WINDOWS_ALREADY_OPEN")

        subprocess.Popen([NOTEPAD_PROCESS_NAME])  # noqa: S603 - fixed literal
        deadline = time.monotonic() + NEW_WINDOW_TIMEOUT_SECONDS
        candidate: WindowTarget | None = None
        stable_polls = 0
        while True:
            created = [
                target
                for target in self._process_windows(NOTEPAD_PROCESS_NAME)
                if target.handle not in existing_handles
            ]
            if len(created) > 1:
                raise DesktopActionFailure("NOTEPAD_WINDOW_AMBIGUOUS")

            observed = created[0] if created and created[0].title.strip() else None
            if (
                observed is not None
                and candidate is not None
                and observed.handle == candidate.handle
            ):
                stable_polls += 1
                if stable_polls >= NEW_WINDOW_STABLE_POLLS:
                    return observed
            else:
                candidate = observed
                stable_polls = 1 if observed is not None else 0

            if time.monotonic() >= deadline:
                raise DesktopActionFailure("NOTEPAD_WINDOW_NOT_FOUND")
            time.sleep(NEW_WINDOW_POLL_INTERVAL_SECONDS)

    def list_process_windows(self, process_name: str) -> tuple[WindowTarget, ...]:
        return tuple(self._process_windows(process_name))

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

    def window_bounds(self, target: WindowTarget) -> ElementBounds:
        left, top, right, bottom = self._win32gui.GetWindowRect(target.handle)
        return ElementBounds(
            left=int(left),
            top=int(top),
            width=int(right) - int(left),
            height=int(bottom) - int(top),
        )

    def locate_control(self, target: WindowTarget, locator: ControlLocator) -> ElementBounds:
        """Resolve a semantic locator to a screen rectangle inside the target window.

        An empty matcher set addresses the window itself, which is what window-relative
        offsets such as a title-bar drag point are measured against.
        """

        criteria: dict[str, str] = {}
        if locator.control_type is not None:
            criteria["control_type"] = locator.control_type
        if locator.automation_id is not None:
            criteria["auto_id"] = locator.automation_id
        if locator.name is not None:
            criteria["title"] = locator.name
        if not criteria:
            return self.window_bounds(target)

        try:
            controls = self._window(target).descendants(**criteria)
        except Exception as error:
            raise DesktopActionFailure("UI_ELEMENT_NOT_FOUND") from error

        bounds = self._visible_control_bounds(controls)
        if not bounds:
            raise DesktopActionFailure("UI_ELEMENT_NOT_FOUND")
        if locator.index is None:
            if len(bounds) != 1:
                raise DesktopActionFailure("UI_ELEMENT_AMBIGUOUS")
            return bounds[0]
        if locator.index >= len(bounds):
            raise DesktopActionFailure("UI_ELEMENT_NOT_FOUND")
        return bounds[locator.index]

    def _visible_control_bounds(self, controls: list[Any]) -> list[ElementBounds]:
        bounds: list[ElementBounds] = []
        for control in controls:
            try:
                if not control.is_visible() or not control.is_enabled():
                    continue
                rectangle = control.rectangle()
                left = int(rectangle.left)
                top = int(rectangle.top)
            except Exception:
                # Controls that disappear while being enumerated are not valid targets.
                continue
            bounds.append(
                ElementBounds(
                    left=left,
                    top=top,
                    width=int(rectangle.right) - left,
                    height=int(rectangle.bottom) - top,
                )
            )
        return bounds

    def display_profile(self) -> DisplayProfile:
        user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        return DisplayProfile(
            width=int(user32.GetSystemMetrics(0)),
            height=int(user32.GetSystemMetrics(1)),
            dpi=int(user32.GetDpiForSystem()),
        )

    def cursor_position(self) -> ScreenPoint:
        x, y = self._win32gui.GetCursorPos()
        return ScreenPoint(x=int(x), y=int(y))

    def mouse_move(self, point: ScreenPoint) -> None:
        self._mouse.move(coords=(point.x, point.y))

    def mouse_click(self, point: ScreenPoint, *, button: MouseButton, click_count: int) -> None:
        if click_count not in (1, 2):
            raise ValueError("Mouse click count must be 1 or 2")
        name = _MOUSE_BUTTON_NAMES[button]
        coords = (point.x, point.y)
        if click_count == 2:
            self._mouse.double_click(button=name, coords=coords)
        else:
            self._mouse.click(button=name, coords=coords)

    def mouse_scroll(self, point: ScreenPoint, *, vertical_delta: int) -> None:
        self._mouse.scroll(coords=(point.x, point.y), wheel_dist=vertical_delta)

    def mouse_drag(self, start: ScreenPoint, end: ScreenPoint, *, button: MouseButton) -> None:
        name = _MOUSE_BUTTON_NAMES[button]
        self._mouse.move(coords=(start.x, start.y))
        # Track the press before it happens so a concurrent emergency stop can release it.
        with self._input_lock:
            self._pressed_buttons.add(name)
        try:
            self._mouse.press(button=name, coords=(start.x, start.y))
            # Move in a few steps: a single teleport can be collapsed into a click by controls
            # that track drag distance, which would silently drop the selection.
            for point in _drag_path(start, end):
                self._mouse.move(coords=(point.x, point.y))
                time.sleep(DRAG_STEP_SECONDS)
        finally:
            self._release_button(name, end)

    def _release_button(self, name: str, point: ScreenPoint) -> None:
        with self._input_lock:
            if name not in self._pressed_buttons:
                # An emergency stop already released this button. A second, unmatched button-up
                # event is delivered to whatever is under the cursor and pops context menus in
                # WinUI applications, so it must not be injected.
                return
            self._pressed_buttons.discard(name)
        self._mouse.release(button=name, coords=(point.x, point.y))

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
        for virtual_key in (0x10, 0x11, 0x12, 0x5B, 0x5C):  # SHIFT, CTRL, ALT, LWIN, RWIN
            user32.keybd_event(virtual_key, 0, key_event_up, 0)
        with self._input_lock:
            pressed_buttons = sorted(self._pressed_buttons)
            self._pressed_buttons.clear()
        # Only buttons that are actually held down are released. Injecting an unmatched
        # button-up event is not a release: Windows delivers it to whatever is under the
        # cursor, which pops context menus in WinUI applications such as Windows 11 Notepad.
        for name in pressed_buttons:
            user32.mouse_event(_MOUSE_UP_EVENTS[name], 0, 0, 0, 0)

    def _window(self, target: WindowTarget) -> Any:
        return self._pywinauto.Desktop(backend="uia").window(handle=target.handle).wrapper_object()


def _drag_path(start: ScreenPoint, end: ScreenPoint) -> tuple[ScreenPoint, ...]:
    """Intermediate points from ``start`` (exclusive) to ``end`` (inclusive)."""

    return tuple(
        ScreenPoint(
            x=start.x + round((end.x - start.x) * step / DRAG_STEP_COUNT),
            y=start.y + round((end.y - start.y) * step / DRAG_STEP_COUNT),
        )
        for step in range(1, DRAG_STEP_COUNT + 1)
    )

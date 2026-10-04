from __future__ import annotations

import ctypes
import subprocess
from pathlib import Path
from threading import Lock
from types import SimpleNamespace

import pytest

from desktop_agent import windows_backend as windows_backend_module
from desktop_agent.protocol import ControlLocator, MouseButton
from desktop_agent.windows_backend import PywinautoWindowsBackend
from desktop_agent.windows_executor import (
    DesktopActionFailure,
    DisplayProfile,
    ElementBounds,
    ScreenPoint,
    WindowTarget,
)


class FakeControl:
    """Synthetic UIA control used to exercise semantic locator matching."""

    def __init__(
        self,
        *,
        control_type: str = "Button",
        auto_id: str = "",
        name: str = "",
        bounds: tuple[int, int, int, int] = (0, 0, 10, 10),
        visible: bool = True,
        enabled: bool = True,
    ) -> None:
        self.element_info = SimpleNamespace(
            control_type=control_type,
            class_name="FixtureControl",
            automation_id=auto_id,
            name=name,
        )
        self._bounds = bounds
        self._visible = visible
        self._enabled = enabled

    def matches(self, criteria: dict[str, str]) -> bool:
        expected_control_type = criteria.get("control_type")
        if expected_control_type is not None and (
            self.element_info.control_type.casefold() != expected_control_type.casefold()
        ):
            return False
        expected_auto_id = criteria.get("auto_id")
        if expected_auto_id is not None and (
            self.element_info.automation_id.casefold() != expected_auto_id.casefold()
        ):
            return False
        expected_title = criteria.get("title")
        return expected_title is None or self.element_info.name == expected_title

    def is_visible(self) -> bool:
        return self._visible

    def is_enabled(self) -> bool:
        return self._enabled

    def rectangle(self) -> SimpleNamespace:
        left, top, right, bottom = self._bounds
        return SimpleNamespace(left=left, top=top, right=right, bottom=bottom)


class FakeWindow:
    def __init__(
        self,
        handle: int,
        process_id: int,
        title: str,
        *,
        document_text: str | None = None,
        children: list[FakeWindow] | None = None,
        controls: list[FakeControl] | None = None,
    ) -> None:
        self.handle = handle
        self.element_info = SimpleNamespace(
            process_id=process_id,
            control_type="Window",
            class_name="FixtureWindow",
            automation_id=f"window-{handle}",
            name=title,
        )
        self._title = title
        self._document_text = document_text
        self._children = children or []
        self._controls = controls or []
        self.focused = False
        self.saved: tuple[str, str] | None = None

    def window_text(self) -> str:
        return self._title

    def set_focus(self) -> None:
        self.focused = True

    def capture_as_image(self) -> FakeWindow:
        return self

    def save(self, destination: str, *, format: str) -> None:
        self.saved = (destination, format)

    def wrapper_object(self) -> FakeWindow:
        return self

    def descendants(self, **criteria: str) -> list[object]:
        if self._controls:
            return [control for control in self._controls if control.matches(criteria)]
        if criteria.get("control_type") == "Document" and self._document_text is not None:
            return [SimpleNamespace(window_text=lambda: self._document_text)]
        return []

    def children(self) -> list[FakeWindow]:
        return self._children

    def is_enabled(self) -> bool:
        return True

    def is_visible(self) -> bool:
        return True


class FakeDesktop:
    def __init__(self, windows: list[FakeWindow]) -> None:
        self._windows = windows

    def windows(self, **_: object) -> list[FakeWindow]:
        return self._windows

    def window(self, *, handle: int) -> FakeWindow:
        return next(window for window in self._windows if window.handle == handle)


class SequencedDesktop:
    """Returns one window set per enumeration, repeating the final state."""

    def __init__(self, states: list[list[FakeWindow]]) -> None:
        self._states = states
        self._index = 0

    def windows(self, **_: object) -> list[FakeWindow]:
        state = self._states[min(self._index, len(self._states) - 1)]
        self._index += 1
        return list(state)


class BrokenWindow(FakeWindow):
    def is_enabled(self) -> bool:
        raise RuntimeError("synthetic UIA failure")


def backend_with_windows(
    windows: list[FakeWindow],
    process_paths: dict[int, str],
) -> PywinautoWindowsBackend:
    return backend_with_desktop(FakeDesktop(windows), process_paths)


def backend_with_desktop(
    desktop: object,
    process_paths: dict[int, str],
) -> PywinautoWindowsBackend:
    backend = object.__new__(PywinautoWindowsBackend)
    backend._pywinauto = SimpleNamespace(Desktop=lambda **_: desktop)
    backend._application = SimpleNamespace(
        process_module=lambda process_id: process_paths[process_id]
    )
    backend._keyboard = SimpleNamespace()
    backend._mouse = SimpleNamespace()
    backend._win32clipboard = SimpleNamespace()
    backend._win32con = SimpleNamespace()
    backend._win32gui = SimpleNamespace()
    backend._win32process = SimpleNamespace()
    backend._input_lock = Lock()
    backend._pressed_buttons = set()
    return backend


class RecordingMouse:
    """Fake pywinauto.mouse module that records every injected event."""

    def __init__(self) -> None:
        self.moves: list[tuple[int, int]] = []
        self.clicks: list[tuple[str, tuple[int, int]]] = []
        self.double_clicks: list[tuple[str, tuple[int, int]]] = []
        self.presses: list[tuple[str, tuple[int, int]]] = []
        self.releases: list[tuple[str, tuple[int, int]]] = []
        self.scrolls: list[tuple[tuple[int, int], int]] = []

    def move(self, coords: tuple[int, int]) -> None:
        self.moves.append(coords)

    def click(self, button: str, coords: tuple[int, int]) -> None:
        self.clicks.append((button, coords))

    def double_click(self, button: str, coords: tuple[int, int]) -> None:
        self.double_clicks.append((button, coords))

    def press(self, button: str, coords: tuple[int, int]) -> None:
        self.presses.append((button, coords))

    def release(self, button: str, coords: tuple[int, int]) -> None:
        self.releases.append((button, coords))

    def scroll(self, coords: tuple[int, int], wheel_dist: int) -> None:
        self.scrolls.append((coords, wheel_dist))


def locator(**overrides: object) -> ControlLocator:
    values: dict[str, object] = {"processName": "notepad.exe"}
    values.update(overrides)
    return ControlLocator.model_validate(values)


def test_finds_unique_window_by_process_and_title() -> None:
    windows = [
        FakeWindow(1, 10, "Other"),
        FakeWindow(2, 20, "Untitled - Notepad"),
    ]
    backend = backend_with_windows(
        windows,
        {10: r"C:\Tools\other.exe", 20: r"C:\Windows\notepad.exe"},
    )

    target = backend.find_window("notepad", "Notepad")

    assert target == WindowTarget(2, 20, "notepad", "Untitled - Notepad")


def test_lists_process_windows_for_pin_validation() -> None:
    windows = [
        FakeWindow(1, 10, "Other"),
        FakeWindow(2, 20, "Untitled - Notepad"),
    ]
    backend = backend_with_windows(
        windows,
        {10: r"C:\Tools\other.exe", 20: r"C:\Windows\notepad.exe"},
    )

    assert backend.list_process_windows("notepad") == (
        WindowTarget(2, 20, "notepad", "Untitled - Notepad"),
    )


def test_rejects_missing_and_ambiguous_windows() -> None:
    windows = [
        FakeWindow(1, 10, "Document A - Notepad"),
        FakeWindow(2, 20, "Document B - Notepad"),
    ]
    backend = backend_with_windows(
        windows,
        {10: r"C:\Windows\notepad.exe", 20: r"C:\Windows\notepad.exe"},
    )

    with pytest.raises(DesktopActionFailure, match="TARGET_APP_NOT_FOUND"):
        backend.find_window("calc", None)
    with pytest.raises(DesktopActionFailure, match="MULTIPLE_TARGET_WINDOWS"):
        backend.find_window("notepad", "Notepad")
    # Two document windows in one process must not be silently collapsed into one target.
    with pytest.raises(DesktopActionFailure, match="MULTIPLE_TARGET_WINDOWS"):
        backend.find_window("notepad", None)
    with pytest.raises(DesktopActionFailure, match="TARGET_WINDOW_NOT_FOUND"):
        backend.find_window("notepad", "Missing title")


def test_start_notepad_returns_the_stable_new_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = FakeWindow(2, 20, "Untitled - Notepad")
    # Before the launch the instance is clean; afterwards the new window keeps existing.
    backend = backend_with_desktop(
        SequencedDesktop([[], [created]]),
        {20: r"C:\Windows\notepad.exe"},
    )
    monkeypatch.setattr(
        subprocess,
        "Popen",
        lambda *_, **__: SimpleNamespace(pid=99),
    )

    assert backend.start_notepad() == WindowTarget(2, 20, "notepad", "Untitled - Notepad")


def test_start_notepad_requires_a_clean_instance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    windows = [FakeWindow(1, 20, "User document - Notepad")]
    backend = backend_with_windows(windows, {20: r"C:\Windows\notepad.exe"})
    launched: list[int] = []

    def fake_popen(*_: object, **__: object) -> SimpleNamespace:
        launched.append(1)
        return SimpleNamespace(pid=99)

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    with pytest.raises(DesktopActionFailure, match="NOTEPAD_WINDOWS_ALREADY_OPEN"):
        backend.start_notepad()
    # A pre-existing instance is never reused, and no process is started either.
    assert launched == []


def test_start_notepad_does_not_accept_a_transient_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transient = FakeWindow(2, 20, "Untitled - Notepad")
    backend = backend_with_desktop(
        SequencedDesktop([[], [transient], []]),
        {20: r"C:\Windows\notepad.exe"},
    )
    monkeypatch.setattr(
        subprocess,
        "Popen",
        lambda *_, **__: SimpleNamespace(pid=99),
    )
    monkeypatch.setattr(windows_backend_module, "NEW_WINDOW_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(windows_backend_module, "NEW_WINDOW_POLL_INTERVAL_SECONDS", 0.0)

    with pytest.raises(DesktopActionFailure, match="NOTEPAD_WINDOW_NOT_FOUND"):
        backend.start_notepad()


def test_start_notepad_ignores_a_window_without_a_title(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    untitled = FakeWindow(2, 20, "")
    backend = backend_with_desktop(
        SequencedDesktop([[], [untitled]]),
        {20: r"C:\Windows\notepad.exe"},
    )
    monkeypatch.setattr(
        subprocess,
        "Popen",
        lambda *_, **__: SimpleNamespace(pid=99),
    )
    monkeypatch.setattr(windows_backend_module, "NEW_WINDOW_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(windows_backend_module, "NEW_WINDOW_POLL_INTERVAL_SECONDS", 0.0)

    with pytest.raises(DesktopActionFailure, match="NOTEPAD_WINDOW_NOT_FOUND"):
        backend.start_notepad()


def test_start_notepad_rejects_ambiguous_new_windows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backend = backend_with_desktop(
        SequencedDesktop(
            [
                [],
                [
                    FakeWindow(2, 20, "First - Notepad"),
                    FakeWindow(3, 20, "Second - Notepad"),
                ],
            ]
        ),
        {20: r"C:\Windows\notepad.exe"},
    )
    monkeypatch.setattr(
        subprocess,
        "Popen",
        lambda *_, **__: SimpleNamespace(pid=99),
    )

    with pytest.raises(DesktopActionFailure, match="NOTEPAD_WINDOW_AMBIGUOUS"):
        backend.start_notepad()


def test_activates_checks_foreground_sends_keys_and_captures(tmp_path: Path) -> None:
    window = FakeWindow(2, 20, "Untitled - Notepad", document_text="fixture text")
    backend = backend_with_windows([window], {20: r"C:\Windows\notepad.exe"})
    backend._win32gui = SimpleNamespace(GetForegroundWindow=lambda: 2)
    backend._win32process = SimpleNamespace(GetWindowThreadProcessId=lambda _: (99, 20))
    sent: list[tuple[str, float, bool]] = []
    backend._keyboard = SimpleNamespace(
        send_keys=lambda keys, pause, vk_packet: sent.append((keys, pause, vk_packet))
    )
    target = WindowTarget(2, 20, "notepad", "Untitled - Notepad")
    destination = tmp_path / "capture.png"

    backend.activate(target)
    backend.send_keys("^a")
    backend.capture_window(target, destination)

    assert window.focused
    assert backend.is_foreground(target)
    assert sent == [("^a", 0.05, False)]
    assert window.saved == (str(destination), "PNG")
    assert backend.read_document_text(target) == "fixture text"


def test_clipboard_is_closed_when_setting_text_fails() -> None:
    backend = backend_with_windows([], {})
    calls: list[str] = []

    def fail_to_set(*_: object) -> None:
        raise RuntimeError("clipboard busy")

    backend._win32clipboard = SimpleNamespace(
        OpenClipboard=lambda: calls.append("open"),
        EmptyClipboard=lambda: calls.append("empty"),
        SetClipboardText=fail_to_set,
        CloseClipboard=lambda: calls.append("close"),
    )
    backend._win32con = SimpleNamespace(CF_UNICODETEXT=13)

    with pytest.raises(RuntimeError, match="clipboard busy"):
        backend.set_clipboard_text("fixture")

    assert calls == ["open", "empty", "close"]


def test_release_inputs_releases_keys_without_injecting_mouse_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backend = backend_with_windows([], {})
    key_events: list[tuple[int, int, int, int]] = []
    mouse_events: list[tuple[int, int, int, int, int]] = []

    def keybd_event(first: int, second: int, third: int, fourth: int) -> None:
        key_events.append((first, second, third, fourth))

    def mouse_event(first: int, second: int, third: int, fourth: int, fifth: int) -> None:
        mouse_events.append((first, second, third, fourth, fifth))

    user32 = SimpleNamespace(
        keybd_event=keybd_event,
        mouse_event=mouse_event,
    )
    monkeypatch.setattr(ctypes, "windll", SimpleNamespace(user32=user32), raising=False)

    backend.release_inputs()

    assert [event[0] for event in key_events] == [0x10, 0x11, 0x12, 0x5B, 0x5C]
    assert all(event[2] == 0x0002 for event in key_events)
    # No button is held down, and an unmatched button-up pops context menus in WinUI apps.
    assert mouse_events == []


def test_release_inputs_releases_exactly_the_held_buttons(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backend = backend_with_windows([], {})
    mouse_events: list[tuple[int, int, int, int, int]] = []
    user32 = SimpleNamespace(
        keybd_event=lambda *_: None,
        mouse_event=lambda *event: mouse_events.append(event),
    )
    monkeypatch.setattr(ctypes, "windll", SimpleNamespace(user32=user32), raising=False)
    backend._pressed_buttons = {"left"}

    backend.release_inputs()
    # A second release must not inject another unmatched button-up event.
    backend.release_inputs()

    assert mouse_events == [(0x0004, 0, 0, 0, 0)]


def test_locates_a_window_when_no_control_matcher_is_given() -> None:
    window = FakeWindow(2, 20, "Untitled - Notepad")
    backend = backend_with_windows([window], {20: r"C:\Windows\notepad.exe"})
    backend._win32gui = SimpleNamespace(
        GetWindowRect=lambda handle: (100, 200, 500, 700),
    )
    target = WindowTarget(2, 20, "notepad", "Untitled - Notepad")

    assert backend.window_bounds(target) == ElementBounds(left=100, top=200, width=400, height=500)
    assert backend.locate_control(target, locator()) == ElementBounds(
        left=100,
        top=200,
        width=400,
        height=500,
    )


def test_locates_controls_by_semantic_criteria() -> None:
    document = FakeControl(
        control_type="Document",
        auto_id="TextEditor",
        name="Text editor",
        bounds=(110, 240, 610, 540),
    )
    window = FakeWindow(2, 20, "Untitled - Notepad", controls=[document])
    backend = backend_with_windows([window], {20: r"C:\Windows\notepad.exe"})
    target = WindowTarget(2, 20, "notepad", "Untitled - Notepad")

    assert backend.locate_control(
        target,
        locator(controlType="document", automationId="texteditor"),
    ) == ElementBounds(left=110, top=240, width=500, height=300)
    assert backend.locate_control(target, locator(name="Text editor")) == ElementBounds(
        left=110,
        top=240,
        width=500,
        height=300,
    )


def test_rejects_missing_ambiguous_and_out_of_range_controls() -> None:
    first = FakeControl(name="Save", bounds=(0, 0, 10, 10))
    second = FakeControl(name="Save", bounds=(20, 20, 30, 30))
    hidden = FakeControl(name="Hidden", bounds=(0, 0, 5, 5), visible=False)
    window = FakeWindow(2, 20, "Untitled - Notepad", controls=[first, second, hidden])
    backend = backend_with_windows([window], {20: r"C:\Windows\notepad.exe"})
    target = WindowTarget(2, 20, "notepad", "Untitled - Notepad")

    with pytest.raises(DesktopActionFailure, match="UI_ELEMENT_AMBIGUOUS"):
        backend.locate_control(target, locator(name="Save"))
    assert backend.locate_control(target, locator(name="Save", index=1)).left == 20
    with pytest.raises(DesktopActionFailure, match="UI_ELEMENT_NOT_FOUND"):
        backend.locate_control(target, locator(name="Save", index=2))
    # Invisible controls are never click targets.
    with pytest.raises(DesktopActionFailure, match="UI_ELEMENT_NOT_FOUND"):
        backend.locate_control(target, locator(name="Hidden"))
    with pytest.raises(DesktopActionFailure, match="UI_ELEMENT_NOT_FOUND"):
        backend.locate_control(target, locator(controlType="Slider"))


def test_mouse_events_are_injected_through_pywinauto() -> None:
    window = FakeWindow(2, 20, "Untitled - Notepad")
    backend = backend_with_windows([window], {20: r"C:\Windows\notepad.exe"})
    mouse = RecordingMouse()
    backend._mouse = mouse

    backend.mouse_move(ScreenPoint(x=10, y=20))
    backend.mouse_click(ScreenPoint(x=30, y=40), button=MouseButton.RIGHT, click_count=1)
    backend.mouse_click(ScreenPoint(x=50, y=60), button=MouseButton.LEFT, click_count=2)
    backend.mouse_scroll(ScreenPoint(x=70, y=80), vertical_delta=-3)
    backend.mouse_drag(
        ScreenPoint(x=90, y=100),
        ScreenPoint(x=110, y=120),
        button=MouseButton.MIDDLE,
    )

    assert mouse.moves == [(10, 20), (90, 100), (110, 120)]
    assert mouse.clicks == [("right", (30, 40))]
    assert mouse.double_clicks == [("left", (50, 60))]
    assert mouse.scrolls == [((70, 80), -3)]
    assert mouse.presses == [("middle", (90, 100))]
    assert mouse.releases == [("middle", (110, 120))]
    assert backend._pressed_buttons == set()


def test_drag_does_not_release_a_button_an_emergency_stop_already_released() -> None:
    window = FakeWindow(2, 20, "Untitled - Notepad")
    backend = backend_with_windows([window], {20: r"C:\Windows\notepad.exe"})
    mouse = RecordingMouse()
    backend._mouse = mouse

    def release_during_press(button: str, coords: tuple[int, int]) -> None:
        backend.release_inputs()

    mouse.press = release_during_press  # type: ignore[method-assign]
    backend.mouse_drag(
        ScreenPoint(x=90, y=100),
        ScreenPoint(x=110, y=120),
        button=MouseButton.LEFT,
    )

    assert mouse.releases == []
    assert backend._pressed_buttons == set()


def test_click_rejects_an_unsupported_click_count() -> None:
    backend = backend_with_windows([], {})
    backend._mouse = RecordingMouse()

    with pytest.raises(ValueError, match="click count"):
        backend.mouse_click(ScreenPoint(x=1, y=2), button=MouseButton.LEFT, click_count=3)


def test_reads_cursor_position_and_display_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    backend = backend_with_windows([], {})
    backend._win32gui = SimpleNamespace(
        GetCursorPos=lambda: (640, 480),
        GetWindowRect=lambda handle: (0, 0, 1920, 1080),
    )
    user32 = SimpleNamespace(
        GetSystemMetrics=lambda index: 1920 if index == 0 else 1080,
        GetDpiForSystem=lambda: 96,
    )
    monkeypatch.setattr(ctypes, "windll", SimpleNamespace(user32=user32), raising=False)

    assert backend.cursor_position() == ScreenPoint(x=640, y=480)
    assert backend.display_profile() == DisplayProfile(width=1920, height=1080, dpi=96)
    assert backend.window_bounds(WindowTarget(1, 20, "notepad", "Notepad")) == ElementBounds(
        left=0,
        top=0,
        width=1920,
        height=1080,
    )


def test_collects_bounded_control_tree() -> None:
    leaf = FakeWindow(3, 20, "Leaf")
    child = FakeWindow(2, 20, "Child", children=[leaf])
    root = FakeWindow(1, 20, "Root", children=[child])
    backend = backend_with_windows([root], {20: r"C:\Tools\wechat.exe"})
    target = WindowTarget(1, 20, "wechat", "Root")

    nodes, truncated = backend.collect_control_tree(target, maximum_nodes=2)

    assert [(node.depth, node.name) for node in nodes] == [(0, "Root"), (1, "Child")]
    assert truncated

    with pytest.raises(ValueError, match="positive"):
        backend.collect_control_tree(target, maximum_nodes=0)


def test_marks_control_tree_incomplete_when_child_read_fails() -> None:
    broken = BrokenWindow(2, 20, "Broken")
    root = FakeWindow(1, 20, "Root", children=[broken])
    backend = backend_with_windows([root], {20: r"C:\Tools\wechat.exe"})

    nodes, truncated = backend.collect_control_tree(
        WindowTarget(1, 20, "wechat", "Root"),
        maximum_nodes=10,
    )

    assert [node.name for node in nodes] == ["Root"]
    assert truncated

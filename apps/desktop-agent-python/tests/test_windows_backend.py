from __future__ import annotations

import ctypes
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from desktop_agent import windows_backend as windows_backend_module
from desktop_agent.windows_backend import PywinautoWindowsBackend
from desktop_agent.windows_executor import DesktopActionFailure, WindowTarget


class FakeWindow:
    def __init__(
        self,
        handle: int,
        process_id: int,
        title: str,
        *,
        document_text: str | None = None,
        children: list[FakeWindow] | None = None,
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

    def descendants(self, *, control_type: str) -> list[SimpleNamespace]:
        if control_type == "Document" and self._document_text is not None:
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


class BrokenWindow(FakeWindow):
    def is_enabled(self) -> bool:
        raise RuntimeError("synthetic UIA failure")


def backend_with_windows(
    windows: list[FakeWindow],
    process_paths: dict[int, str],
) -> PywinautoWindowsBackend:
    backend = object.__new__(PywinautoWindowsBackend)
    desktop = FakeDesktop(windows)
    backend._pywinauto = SimpleNamespace(Desktop=lambda **_: desktop)
    backend._application = SimpleNamespace(
        process_module=lambda process_id: process_paths[process_id]
    )
    backend._keyboard = SimpleNamespace()
    backend._win32clipboard = SimpleNamespace()
    backend._win32con = SimpleNamespace()
    backend._win32gui = SimpleNamespace()
    backend._win32process = SimpleNamespace()
    return backend


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


def test_start_notepad_returns_title_of_newly_created_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    existing = FakeWindow(1, 20, "Existing - Notepad")
    created = FakeWindow(2, 20, "Untitled - Notepad")
    windows = [existing]
    backend = backend_with_windows(windows, {20: r"C:\Windows\notepad.exe"})

    def fake_popen(*_: object, **__: object) -> SimpleNamespace:
        windows.append(created)
        return SimpleNamespace(pid=99)

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    # The window created by this call wins, even though another window already matched.
    assert backend.start_notepad() == "Untitled - Notepad"


def test_start_notepad_never_falls_back_to_an_existing_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    windows = [FakeWindow(1, 20, "User document - Notepad")]
    backend = backend_with_windows(windows, {20: r"C:\Windows\notepad.exe"})
    monkeypatch.setattr(
        subprocess,
        "Popen",
        lambda *_, **__: SimpleNamespace(pid=99),
    )
    monkeypatch.setattr(windows_backend_module, "NEW_WINDOW_TIMEOUT_SECONDS", 0.0)

    with pytest.raises(DesktopActionFailure, match="NOTEPAD_WINDOW_NOT_FOUND"):
        backend.start_notepad()


def test_start_notepad_rejects_ambiguous_new_windows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    windows = [FakeWindow(1, 20, "Existing - Notepad")]
    backend = backend_with_windows(windows, {20: r"C:\Windows\notepad.exe"})

    def fake_popen(*_: object, **__: object) -> SimpleNamespace:
        windows.extend(
            [
                FakeWindow(2, 20, "First - Notepad"),
                FakeWindow(3, 20, "Second - Notepad"),
            ]
        )
        return SimpleNamespace(pid=99)

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

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


def test_release_inputs_sends_key_and_mouse_up(monkeypatch: pytest.MonkeyPatch) -> None:
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
    assert [event[0] for event in mouse_events] == [0x0004, 0x0010, 0x0040, 0x0100, 0x0100]


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

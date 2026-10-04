from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

import pytest

from desktop_agent.notepad_mouse_spike import (
    LONG_DOCUMENT_LINES,
    NOTEPAD_PROCESS,
    NotepadMouseSpikeBackend,
    run_notepad_mouse_spike,
    write_report,
)
from desktop_agent.protocol import ControlLocator, MouseButton
from desktop_agent.windows_executor import (
    DesktopActionFailure,
    DisplayProfile,
    ElementBounds,
    ScreenPoint,
    WindowTarget,
)

NOW = datetime(2026, 10, 4, 4, 0, tzinfo=UTC)
TARGET = WindowTarget(123, 456, "notepad", "Untitled - Notepad")
WINDOW_BOUNDS = ElementBounds(left=100, top=200, width=913, height=583)
DOCUMENT_BOUNDS = ElementBounds(left=140, top=280, width=400, height=300)
LINE_HEIGHT = 20
CHAR_WIDTH = 7
PADDING_X = 10
PADDING_Y = 5
LINES_PER_TICK = 3


class SimulatedNotepadBackend(NotepadMouseSpikeBackend):
    """Simulated Notepad editor: caret, selection, viewport and clipboard are all modelled.

    The simulation is what makes the spike verifiable off Windows: every assertion in the spike
    is checked against editor state that only changes when the injected input really lands.
    """

    def __init__(self, *, setup_error: Exception | None = None) -> None:
        self.document = ""
        self.caret = 0
        self.selection: tuple[int, int] | None = None
        self.view_top_line = 0
        self.clipboard = ""
        self.cursor = ScreenPoint(x=0, y=0)
        self.release_count = 0
        self.setup_error = setup_error
        self.activated: list[WindowTarget] = []
        self.screenshots: list[Path] = []
        self.mouse_clicks: list[ScreenPoint] = []

    # --- lifecycle ------------------------------------------------------------------
    def start_notepad(self) -> WindowTarget | None:
        if self.setup_error is not None:
            raise self.setup_error
        return TARGET

    def list_process_windows(self, process_name: str) -> tuple[WindowTarget, ...]:
        assert process_name == NOTEPAD_PROCESS.removesuffix(".exe")
        return (TARGET,)

    def find_window(self, process_name: str, title_contains: str | None) -> WindowTarget:
        return TARGET

    def activate(self, target: WindowTarget) -> None:
        self.activated.append(target)

    def is_foreground(self, target: WindowTarget) -> bool:
        return target == TARGET

    def environment_metadata(self) -> dict[str, str | int]:
        return {"os": "Windows-11-test", "python": "3.11.test", "pywinauto": "0.6.9"}

    def display_profile(self) -> DisplayProfile:
        return DisplayProfile(width=1920, height=1080, dpi=96)

    # --- geometry -------------------------------------------------------------------
    def window_bounds(self, target: WindowTarget) -> ElementBounds:
        return WINDOW_BOUNDS

    def locate_control(self, target: WindowTarget, locator: ControlLocator) -> ElementBounds:
        assert locator.control_type == "Document"
        return DOCUMENT_BOUNDS

    def cursor_position(self) -> ScreenPoint:
        return self.cursor

    # --- input ----------------------------------------------------------------------
    def mouse_move(self, point: ScreenPoint) -> None:
        self.cursor = point

    def mouse_click(self, point: ScreenPoint, *, button: MouseButton, click_count: int) -> None:
        self.cursor = point
        self.mouse_clicks.append(point)
        self.caret = self._index_at(point)
        self.selection = None
        self._keep_caret_visible()

    def mouse_drag(self, start: ScreenPoint, end: ScreenPoint, *, button: MouseButton) -> None:
        self.cursor = end
        start_index = self._index_at(start)
        end_index = self._index_at(end)
        self.caret = end_index
        self.selection = (start_index, end_index) if start_index != end_index else None
        self._keep_caret_visible()

    def mouse_scroll(self, point: ScreenPoint, *, vertical_delta: int) -> None:
        self.cursor = point
        self.view_top_line = self._clamp_view(self.view_top_line - vertical_delta * LINES_PER_TICK)

    def set_clipboard_text(self, text: str) -> None:
        self.clipboard = text

    def get_clipboard_text(self) -> str:
        return self.clipboard

    def send_keys(self, keys: str) -> None:
        if keys == "^a":
            self.selection = (0, len(self.document))
        elif keys == "^c":
            if self.selection is not None and self.selection[0] != self.selection[1]:
                self.clipboard = self.document[self.selection[0] : self.selection[1]]
        elif keys == "^v":
            start, end = self.selection if self.selection is not None else (self.caret, self.caret)
            self.document = f"{self.document[:start]}{self.clipboard}{self.document[end:]}"
            self.caret = start + len(self.clipboard)
            self.selection = None
            self._keep_caret_visible()
        else:
            raise AssertionError(f"Unexpected key chord '{keys}'")

    def read_document_text(self, target: WindowTarget) -> str:
        return self.document

    def capture_window(self, target: WindowTarget, destination: Path) -> None:
        self.screenshots.append(destination)

    def release_inputs(self) -> None:
        self.release_count += 1

    def send_chat_text(self, target: WindowTarget, text: str) -> None:
        raise AssertionError("The mouse spike must not send chat text")

    # --- simulated editor internals --------------------------------------------------
    def _lines(self) -> list[str]:
        return self.document.split("\n")

    def _visible_lines(self) -> int:
        return max(1, DOCUMENT_BOUNDS.height // LINE_HEIGHT)

    def _clamp_view(self, line: int) -> int:
        maximum = max(0, len(self._lines()) - self._visible_lines())
        return max(0, min(line, maximum))

    def _line_start(self, line: int) -> int:
        return sum(len(text) + 1 for text in self._lines()[:line])

    def _index_at(self, point: ScreenPoint) -> int:
        lines = self._lines()
        local_y = point.y - DOCUMENT_BOUNDS.top - PADDING_Y
        line_in_view = max(0, local_y // LINE_HEIGHT)
        line = min(self.view_top_line + line_in_view, len(lines) - 1)
        local_x = point.x - DOCUMENT_BOUNDS.left - PADDING_X
        column = max(0, min(round(local_x / CHAR_WIDTH), len(lines[line])))
        return self._line_start(line) + column

    def _keep_caret_visible(self) -> None:
        line = self.document.count("\n", 0, self.caret)
        visible = self._visible_lines()
        if line < self.view_top_line:
            self.view_top_line = self._clamp_view(line)
        elif line >= self.view_top_line + visible:
            self.view_top_line = self._clamp_view(line - visible + 1)


async def run_one_iteration(backend: NotepadMouseSpikeBackend, tmp_path: Path) -> str | None:
    report = await run_notepad_mouse_spike(backend, tmp_path, iterations=1, clock=lambda: NOW)
    return report.runs[0].error_code if report.runs else report.setup_error


@pytest.mark.asyncio
async def test_simulated_notepad_verifies_every_mouse_action(tmp_path: Path) -> None:
    backend = SimulatedNotepadBackend()

    report = await run_notepad_mouse_spike(backend, tmp_path, iterations=2, clock=lambda: NOW)

    assert report.passed
    assert report.success_count == 2
    assert report.error_counts == {}
    assert report.coordinate_mouse_profile == "1920x1080@96"
    assert report.display_profile == {"width": 1920, "height": 1080, "dpi": 96}
    assert report.environment["os"] == "Windows-11-test"
    assert backend.release_count == 2
    assert len(backend.screenshots) == 2
    assert backend.document.count("M0-MOUSE-LINE") == LONG_DOCUMENT_LINES
    assert json.loads(report.to_json())["passed"] is True

    # Each run records the measured geometry and the observed indices but never document text.
    diagnostics = report.runs[0].diagnostics
    assert diagnostics is not None
    assert set(diagnostics) == {
        "windowBounds",
        "documentBounds",
        "caretIndices",
        "documentLength",
        "selectedCharacters",
        "clipboardSelectionLength",
        "clipboardSelectionMatches",
        "lineEnding",
        "scrollResetLength",
        "scrollLines",
        "scrollIndices",
        "scrollDocumentLengths",
    }
    assert diagnostics["windowBounds"] == [100, 200, 913, 583]
    assert diagnostics["documentBounds"] == [140, 280, 400, 300]
    upper, lower, coordinate = cast(list[int], diagnostics["caretIndices"])
    assert 0 <= upper < lower
    assert coordinate == lower
    assert cast(int, diagnostics["selectedCharacters"]) > 0
    assert diagnostics["clipboardSelectionMatches"] is True
    assert diagnostics["lineEnding"] == "lf"
    bottom, scrolled_up, scrolled_down = cast(list[int], diagnostics["scrollLines"])
    assert scrolled_up < bottom
    assert scrolled_down > scrolled_up
    # The reset paste must have produced the full generated document, not a leftover selection.
    assert (
        cast(int, diagnostics["scrollResetLength"])
        > len("M0-MOUSE-LINE-000-") * LONG_DOCUMENT_LINES
    )
    lengths = cast(list[int], diagnostics["scrollDocumentLengths"])
    # Each probe's document differs from the reset document only by the markers inserted so far;
    # a shrinking document would mean a click replaced a selection instead of placing a caret.
    assert lengths[0] == cast(int, diagnostics["scrollResetLength"])
    assert all(later >= earlier for earlier, later in zip(lengths, lengths[1:], strict=False))


@pytest.mark.asyncio
async def test_reports_a_setup_failure_without_running_iterations(tmp_path: Path) -> None:
    backend = SimulatedNotepadBackend(setup_error=DesktopActionFailure("NOTEPAD_WINDOW_NOT_FOUND"))

    report = await run_notepad_mouse_spike(backend, tmp_path, iterations=3, clock=lambda: NOW)

    assert not report.passed
    assert report.setup_error == "NOTEPAD_WINDOW_NOT_FOUND"
    assert report.runs == ()
    assert report.error_counts == {"NOTEPAD_WINDOW_NOT_FOUND": 1}


@pytest.mark.asyncio
async def test_reports_an_unexpected_setup_error(tmp_path: Path) -> None:
    backend = SimulatedNotepadBackend(setup_error=RuntimeError("synthetic failure"))

    report = await run_notepad_mouse_spike(backend, tmp_path, iterations=1, clock=lambda: NOW)

    assert report.setup_error == "SPIKE_SETUP_FAILED"


class StationaryCursorBackend(SimulatedNotepadBackend):
    def mouse_move(self, point: ScreenPoint) -> None:
        return None


class CaretIgnoringBackend(SimulatedNotepadBackend):
    def mouse_click(self, point: ScreenPoint, *, button: MouseButton, click_count: int) -> None:
        self.cursor = point
        self.mouse_clicks.append(point)


class UnselectingBackend(SimulatedNotepadBackend):
    def mouse_drag(self, start: ScreenPoint, end: ScreenPoint, *, button: MouseButton) -> None:
        self.cursor = end


class UnscrollingBackend(SimulatedNotepadBackend):
    def mouse_scroll(self, point: ScreenPoint, *, vertical_delta: int) -> None:
        self.cursor = point


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("backend_factory", "error_code"),
    [
        (StationaryCursorBackend, "MOUSE_CURSOR_MISMATCH"),
        (CaretIgnoringBackend, "MOUSE_CLICK_CARET_MISMATCH"),
        (UnselectingBackend, "MOUSE_DRAG_SELECTION_MISMATCH"),
        (UnscrollingBackend, "MOUSE_SCROLL_UP_NOT_OBSERVED"),
    ],
)
async def test_detects_mouse_input_that_has_no_effect(
    backend_factory: type[SimulatedNotepadBackend],
    error_code: str,
    tmp_path: Path,
) -> None:
    assert await run_one_iteration(backend_factory(), tmp_path) == error_code


@pytest.mark.asyncio
async def test_rejects_invalid_iteration_counts(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="iterations must be positive"):
        await run_notepad_mouse_spike(SimulatedNotepadBackend(), tmp_path, iterations=0)


@pytest.mark.asyncio
async def test_writes_a_redacted_report(tmp_path: Path) -> None:
    report = await run_notepad_mouse_spike(
        SimulatedNotepadBackend(), tmp_path, iterations=1, clock=lambda: NOW
    )

    destination = write_report(report, tmp_path)

    payload = json.loads(destination.read_text(encoding="utf-8"))
    assert destination.parent == tmp_path / "reports"
    assert payload["passed"] is True
    content = destination.read_text(encoding="utf-8")
    # The report carries geometry and indices only, never the document text.
    assert "M0-MOUSE-LINE" not in content

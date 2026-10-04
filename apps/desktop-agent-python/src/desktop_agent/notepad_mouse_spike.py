"""Repeatable Windows M0 mouse smoke test for the guarded desktop executor.

Every iteration drives real pointer input into a freshly launched Notepad window and then
verifies the effect through UIA text reads and clipboard read-back rather than trusting that an
event was delivered:

* ``MOUSE_MOVE`` - the reported pointer position must equal the located control centre.
* ``MOUSE_CLICK`` - the caret must follow the click. The document deliberately overflows the
  editor viewport, so probes at two different heights both land on text; each probe inserts a
  marker whose character index proves where the caret went, and the lower probe must produce a
  larger index than the upper one.
* ``MOUSE_CLICK_POSITION`` - the window-relative coordinate path must reproduce the semantic
  click exactly: the pointer must be at the computed point and the marker index must match.
* ``MOUSE_DRAG`` - the drag must select text, proven by copying the selection to the clipboard.
* ``MOUSE_SCROLL`` - the visible text must move: a probe marker's line index has to decrease
  after scrolling up and increase again after scrolling down.

Probe points are fractions of the located control rectangle, never hand-calibrated pixel
offsets, so the checks stay valid wherever the control rectangle actually begins (Windows 11
Notepad may fold the tab strip into it). Each iteration records the measured rectangles and the
observed marker indices in the report, so a failure can be diagnosed without another real run.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from collections import Counter
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from time import perf_counter
from typing import Protocol
from uuid import UUID, uuid4

from .config import DEFAULT_ARTIFACT_DIRECTORY
from .execution import CommandExecutionResult
from .protocol import (
    ClipboardSetTextArguments,
    ClipboardSetTextPayload,
    ControlLocator,
    InputKey,
    InputKeyChordArguments,
    InputKeyChordPayload,
    MouseButton,
    MouseClickArguments,
    MouseClickPayload,
    MouseClickPositionArguments,
    MouseClickPositionPayload,
    MouseDragArguments,
    MouseDragPayload,
    MouseMoveArguments,
    MouseMovePayload,
    MouseScrollArguments,
    MouseScrollPayload,
    TakeScreenshotArguments,
    TakeScreenshotPayload,
    WindowActivateArguments,
    WindowActivatePayload,
    WindowSelector,
)
from .windows_executor import (
    DesktopActionFailure,
    DisplayProfile,
    ElementBounds,
    ScreenPoint,
    WindowsBackend,
    WindowsDesktopActionExecutor,
    WindowTarget,
    normalize_process_name,
)

SPIKE_ITERATIONS = 20
PASS_RATE = 0.95
NOTEPAD_PROCESS = "notepad.exe"
DOCUMENT_CONTROL_TYPE = "Document"
COMMAND_LIFETIME = timedelta(minutes=1)
CURSOR_TOLERANCE_PIXELS = 2
# Probe points are fractions of the located control rectangle. Fractions keep every probe inside
# the editor no matter where the rectangle starts, and the long document keeps text under every
# probe even if the rectangle is taller than the viewport.
CLICK_X_FRACTION = 0.30
CLICK_UPPER_FRACTION = 0.35
CLICK_LOWER_FRACTION = 0.75
DRAG_X_START_FRACTION = 0.30
DRAG_X_END_FRACTION = 0.45
DRAG_UPPER_FRACTION = 0.40
DRAG_LOWER_FRACTION = 0.70
SCROLL_X_FRACTION = 0.50
SCROLL_TOP_FRACTION = 0.20
MAXIMUM_LOCATOR_OFFSET = 2_000
SCROLL_TICKS = 5
# Windows processes the injected click asynchronously; give the target a moment before reading
# back the caret-dependent result.
SETTLE_SECONDS = 0.1
LONG_DOCUMENT_LINES = 30
LONG_DOCUMENT_LINE_WIDTH = 130
# Markers must not occur in the generated document text.
MARKERS = ("@", "#", "$", "%", "&", "~", "?")


class NotepadMouseSpikeBackend(WindowsBackend, Protocol):
    def start_notepad(self) -> WindowTarget | None:
        """Launch notepad.exe and return the window it created, if it can be identified."""

    def get_clipboard_text(self) -> str: ...

    def read_document_text(self, target: WindowTarget) -> str: ...

    def environment_metadata(self) -> dict[str, str | int]: ...


@dataclass(frozen=True, slots=True)
class SpikeIteration:
    iteration: int
    succeeded: bool
    duration_ms: int
    error_code: str | None
    # Measured geometry and observed indices only; never document text.
    diagnostics: dict[str, object] | None = None


@dataclass(frozen=True, slots=True)
class MouseSpikeReport:
    started_at: str
    finished_at: str
    target_process: str
    requested_iterations: int
    success_count: int
    success_rate: float
    passed: bool
    coordinate_mouse_profile: str | None
    display_profile: dict[str, int]
    environment: dict[str, str | int]
    error_counts: dict[str, int]
    runs: tuple[SpikeIteration, ...]
    setup_error: str | None = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=True, indent=2)


async def run_notepad_mouse_spike(
    backend: NotepadMouseSpikeBackend,
    artifact_directory: Path,
    *,
    iterations: int = SPIKE_ITERATIONS,
    clock: Callable[[], datetime] | None = None,
) -> MouseSpikeReport:
    if iterations < 1:
        raise ValueError("Spike iterations must be positive")

    now = clock or (lambda: datetime.now(UTC))
    started_at = now()
    environment: dict[str, str | int] = {}
    display: DisplayProfile | None = None
    target: WindowTarget
    try:
        environment = await asyncio.to_thread(backend.environment_metadata)
        display = await asyncio.to_thread(backend.display_profile)
        launched = await asyncio.to_thread(backend.start_notepad)
        if launched is None:
            raise DesktopActionFailure("TARGET_WINDOW_NOT_FOUND")
        # The window is targeted by handle from here on: this Notepad rewrites its own title
        # from the document content that the run itself types in.
        target = await _require_live_target(backend, launched)
    except Exception as error:
        return _build_report(
            started_at,
            now(),
            iterations,
            environment,
            display,
            (),
            _error_code(error, fallback="SPIKE_SETUP_FAILED"),
        )

    executor = WindowsDesktopActionExecutor(
        backend,
        allowed_processes=frozenset({NOTEPAD_PROCESS}),
        artifact_directory=artifact_directory,
        # The spike deliberately exercises the default-off coordinate path so that its
        # window-relative arithmetic is verified against the calibrated machine profile.
        coordinate_mouse_profile=display,
    )
    executor.pin_target(target)
    runs: list[SpikeIteration] = []

    for iteration in range(1, iterations + 1):
        run_started = perf_counter()
        error_code: str | None = None
        diagnostics: dict[str, object] = {}
        try:
            await _run_iteration(executor, backend, iteration, now(), target, diagnostics)
        except DesktopActionFailure as error:
            error_code = error.code
        except Exception:
            error_code = "SPIKE_UNEXPECTED_ERROR"
        finally:
            try:
                await executor.emergency_stop()
            except Exception:
                error_code = error_code or "EMERGENCY_STOP_FAILED"

        runs.append(
            SpikeIteration(
                iteration=iteration,
                succeeded=error_code is None,
                duration_ms=max(0, round((perf_counter() - run_started) * 1_000)),
                error_code=error_code,
                diagnostics=diagnostics or None,
            )
        )

    return _build_report(
        started_at,
        now(),
        iterations,
        environment,
        display,
        tuple(runs),
        None,
    )


async def _run_iteration(
    executor: WindowsDesktopActionExecutor,
    backend: NotepadMouseSpikeBackend,
    iteration: int,
    now: datetime,
    target: WindowTarget,
    diagnostics: dict[str, object],
) -> None:
    task_id = uuid4()
    expires_at = now + COMMAND_LIFETIME
    document = _document_locator()
    text = _long_document()

    await _require_success(
        executor.execute(
            WindowActivatePayload(
                command_id=uuid4(),
                task_id=task_id,
                expires_at=expires_at,
                action="WINDOW_ACTIVATE",
                arguments=WindowActivateArguments(
                    process_name=NOTEPAD_PROCESS,
                    title_contains=target.title,
                ),
            ),
            Event(),
        )
    )

    # Record the geometry so a failed iteration can be diagnosed from the report alone.
    bounds = await asyncio.to_thread(backend.locate_control, target, document)
    window_bounds = await asyncio.to_thread(backend.window_bounds, target)
    diagnostics["windowBounds"] = _bounds_record(window_bounds)
    diagnostics["documentBounds"] = _bounds_record(bounds)

    # Move: the pointer must really end up at the located control centre.
    centre = _bounds_centre(bounds)
    await _require_success(
        executor.execute(
            MouseMovePayload(
                command_id=uuid4(),
                task_id=task_id,
                expires_at=expires_at,
                action="MOUSE_MOVE",
                arguments=MouseMoveArguments(target=document),
            ),
            Event(),
        )
    )
    await _require_cursor(backend, centre, "MOUSE_CURSOR_MISMATCH")

    probes = _probe_offsets(bounds)

    # Click: both probes land on text because the document overflows the viewport. The caret
    # index of the lower probe must be greater than the upper one, which proves the caret
    # followed the click instead of staying where the paste left it.
    await _paste(executor, backend, text, task_id, expires_at)
    upper_text = await _click_and_read(
        executor, backend, target, probes["clickUpper"], MARKERS[0], task_id, expires_at
    )
    upper_index = _marker_character_index(upper_text, MARKERS[0])

    await _paste(executor, backend, text, task_id, expires_at)
    lower_text = await _click_and_read(
        executor, backend, target, probes["clickLower"], MARKERS[1], task_id, expires_at
    )
    lower_index = _marker_character_index(lower_text, MARKERS[1])

    # Reset to the same text first: comparing against a document that still carries the previous
    # marker would make the expected index ambiguous by one character.
    await _paste(executor, backend, text, task_id, expires_at)
    coordinate_index = await _click_position_and_read(
        executor,
        backend,
        target,
        bounds,
        window_bounds,
        probes["clickLower"],
        MARKERS[2],
        task_id,
        expires_at,
    )
    diagnostics["caretIndices"] = [upper_index, lower_index, coordinate_index]
    if upper_index >= lower_index:
        raise DesktopActionFailure("MOUSE_CLICK_CARET_MISMATCH")
    if coordinate_index != lower_index:
        raise DesktopActionFailure("COORDINATE_CLICK_CARET_MISMATCH")

    # Drag: dragging across lines must select text. The pass/fail proof depends only on mouse-driven
    # state: pasting a marker over the selection removes exactly the selected characters, so the
    # document length delta measures the selection without depending on clipboard text encoding
    # (the clipboard uses CRLF while the compared document uses LF).
    await _paste(executor, backend, text, task_id, expires_at)
    before_drag = str(await asyncio.to_thread(backend.read_document_text, target))
    await _drag(
        executor,
        backend,
        target,
        probes["dragStart"],
        probes["dragEnd"],
        task_id,
        expires_at,
    )
    copied = await _copy(executor, backend, task_id, expires_at)
    after_drag = await _insert_and_read(executor, backend, target, MARKERS[6], task_id, expires_at)
    selected = len(before_drag) + len(MARKERS[6]) - len(after_drag)
    normalized_copy = _normalize_newlines(copied)
    normalized_document = _normalize_newlines(before_drag)
    diagnostics["documentLength"] = len(before_drag)
    diagnostics["selectedCharacters"] = selected
    diagnostics["clipboardSelectionLength"] = len(copied)
    diagnostics["clipboardSelectionMatches"] = (
        bool(normalized_copy)
        and len(normalized_copy) < len(normalized_document)
        and normalized_copy in normalized_document
    )
    diagnostics["lineEnding"] = _line_ending(before_drag)
    if not 0 < selected < len(before_drag):
        raise DesktopActionFailure("MOUSE_DRAG_SELECTION_MISMATCH")

    # Scroll: pasting leaves the caret, and therefore the view, at the bottom, so the first wheel
    # action scrolls up and the second returns to the bottom.
    await _paste(executor, backend, text, task_id, expires_at)
    bottom_line_text = await _click_and_read(
        executor, backend, target, probes["scrollTop"], MARKERS[3], task_id, expires_at
    )
    bottom_line = _marker_line_index(bottom_line_text, MARKERS[3])

    await _scroll(executor, document, task_id, expires_at, SCROLL_TICKS)
    scrolled_up_text = await _click_and_read(
        executor, backend, target, probes["scrollTop"], MARKERS[4], task_id, expires_at
    )
    scrolled_up = _marker_line_index(scrolled_up_text, MARKERS[4])
    if scrolled_up >= bottom_line:
        raise DesktopActionFailure("MOUSE_SCROLL_UP_NOT_OBSERVED")

    await _scroll(executor, document, task_id, expires_at, -SCROLL_TICKS)
    scrolled_down_text = await _click_and_read(
        executor, backend, target, probes["scrollTop"], MARKERS[5], task_id, expires_at
    )
    scrolled_down = _marker_line_index(scrolled_down_text, MARKERS[5])
    diagnostics["scrollLines"] = [bottom_line, scrolled_up, scrolled_down]
    if scrolled_down <= scrolled_up:
        raise DesktopActionFailure("MOUSE_SCROLL_DOWN_NOT_OBSERVED")

    screenshot = TakeScreenshotPayload(
        command_id=uuid4(),
        task_id=task_id,
        expires_at=expires_at,
        action="TAKE_SCREENSHOT",
        arguments=TakeScreenshotArguments(artifact_name=f"notepad-mouse-{iteration:02d}"),
    )
    await _require_success(executor.execute(screenshot, Event()))


async def _click_and_read(
    executor: WindowsDesktopActionExecutor,
    backend: NotepadMouseSpikeBackend,
    target: WindowTarget,
    offset: tuple[int, int],
    marker: str,
    task_id: UUID,
    expires_at: datetime,
) -> str:
    """Click a control-relative point, type ``marker`` there and return the document text."""

    result = await executor.execute(
        MouseClickPayload(
            command_id=uuid4(),
            task_id=task_id,
            expires_at=expires_at,
            action="MOUSE_CLICK",
            arguments=MouseClickArguments(
                target=_document_locator(offset=offset),
                button=MouseButton.LEFT,
                click_count=1,
            ),
        ),
        Event(),
    )
    if result.outcome.value != "SUCCEEDED":
        raise DesktopActionFailure(result.error_code or "MOUSE_CLICK_FAILED")

    await _settle()
    return await _insert_and_read(executor, backend, target, marker, task_id, expires_at)


async def _click_position_and_read(
    executor: WindowsDesktopActionExecutor,
    backend: NotepadMouseSpikeBackend,
    target: WindowTarget,
    bounds: ElementBounds,
    window_bounds: ElementBounds,
    offset: tuple[int, int],
    marker: str,
    task_id: UUID,
    expires_at: datetime,
) -> int:
    """Click the same point through the window-relative coordinate path.

    The point is computed from the measured rectangles, so the pointer check and the caret index
    must both match the equivalent semantic click.
    """

    relative_x = bounds.left - window_bounds.left + offset[0]
    relative_y = bounds.top - window_bounds.top + offset[1]
    result = await executor.execute(
        MouseClickPositionPayload(
            command_id=uuid4(),
            task_id=task_id,
            expires_at=expires_at,
            action="MOUSE_CLICK_POSITION",
            arguments=MouseClickPositionArguments(
                target=WindowSelector(process_name=NOTEPAD_PROCESS),
                x=relative_x,
                y=relative_y,
            ),
        ),
        Event(),
    )
    if result.outcome.value != "SUCCEEDED":
        raise DesktopActionFailure(result.error_code or "COORDINATE_CLICK_FAILED")

    await _require_cursor(
        backend,
        ScreenPoint(x=window_bounds.left + relative_x, y=window_bounds.top + relative_y),
        "COORDINATE_CLICK_POINT_MISMATCH",
    )
    await _settle()
    document_text = await _insert_and_read(executor, backend, target, marker, task_id, expires_at)
    return _marker_character_index(document_text, marker)


async def _drag(
    executor: WindowsDesktopActionExecutor,
    backend: NotepadMouseSpikeBackend,
    target: WindowTarget,
    start: tuple[int, int],
    end: tuple[int, int],
    task_id: UUID,
    expires_at: datetime,
) -> None:
    """Drag between two control-relative points."""

    result = await executor.execute(
        MouseDragPayload(
            command_id=uuid4(),
            task_id=task_id,
            expires_at=expires_at,
            action="MOUSE_DRAG",
            arguments=MouseDragArguments(
                from_control=_document_locator(offset=start),
                to_control=_document_locator(offset=end),
                button=MouseButton.LEFT,
            ),
        ),
        Event(),
    )
    if result.outcome.value != "SUCCEEDED":
        raise DesktopActionFailure(result.error_code or "MOUSE_DRAG_FAILED")

    await _settle()


async def _copy(
    executor: WindowsDesktopActionExecutor,
    backend: NotepadMouseSpikeBackend,
    task_id: UUID,
    expires_at: datetime,
) -> str:
    """Copy the current selection and return the clipboard content (evidence, not a gate)."""

    await _require_success(
        executor.execute(
            InputKeyChordPayload(
                command_id=uuid4(),
                task_id=task_id,
                expires_at=expires_at,
                action="INPUT_KEY_CHORD",
                arguments=InputKeyChordArguments(keys=[InputKey.CTRL, InputKey.C]),
            ),
            Event(),
        )
    )
    return str(await asyncio.to_thread(backend.get_clipboard_text))


async def _scroll(
    executor: WindowsDesktopActionExecutor,
    document: ControlLocator,
    task_id: UUID,
    expires_at: datetime,
    vertical_delta: int,
) -> None:
    await _require_success(
        executor.execute(
            MouseScrollPayload(
                command_id=uuid4(),
                task_id=task_id,
                expires_at=expires_at,
                action="MOUSE_SCROLL",
                arguments=MouseScrollArguments(target=document, vertical_delta=vertical_delta),
            ),
            Event(),
        )
    )


async def _paste(
    executor: WindowsDesktopActionExecutor,
    backend: NotepadMouseSpikeBackend,
    text: str,
    task_id: UUID,
    expires_at: datetime,
) -> None:
    """Replace the whole document content with ``text`` through the clipboard."""

    await _require_success(
        executor.execute(
            InputKeyChordPayload(
                command_id=uuid4(),
                task_id=task_id,
                expires_at=expires_at,
                action="INPUT_KEY_CHORD",
                arguments=InputKeyChordArguments(keys=[InputKey.CTRL, InputKey.A]),
            ),
            Event(),
        )
    )
    await _insert(executor, backend, text, task_id, expires_at)


async def _insert_and_read(
    executor: WindowsDesktopActionExecutor,
    backend: NotepadMouseSpikeBackend,
    target: WindowTarget,
    text: str,
    task_id: UUID,
    expires_at: datetime,
) -> str:
    await _insert(executor, backend, text, task_id, expires_at)
    return str(await asyncio.to_thread(backend.read_document_text, target))


async def _insert(
    executor: WindowsDesktopActionExecutor,
    backend: NotepadMouseSpikeBackend,
    text: str,
    task_id: UUID,
    expires_at: datetime,
) -> None:
    """Insert ``text`` at the current caret position through the clipboard."""

    await _require_success(
        executor.execute(
            ClipboardSetTextPayload(
                command_id=uuid4(),
                task_id=task_id,
                expires_at=expires_at,
                action="CLIPBOARD_SET_TEXT",
                arguments=ClipboardSetTextArguments(text=text),
            ),
            Event(),
        )
    )
    await _require_success(
        executor.execute(
            InputKeyChordPayload(
                command_id=uuid4(),
                task_id=task_id,
                expires_at=expires_at,
                action="INPUT_KEY_CHORD",
                arguments=InputKeyChordArguments(keys=[InputKey.CTRL, InputKey.V]),
            ),
            Event(),
        )
    )
    await asyncio.sleep(SETTLE_SECONDS)


async def _require_cursor(
    backend: NotepadMouseSpikeBackend,
    expected: ScreenPoint,
    error_code: str,
) -> None:
    cursor = await asyncio.to_thread(backend.cursor_position)
    if (
        abs(cursor.x - expected.x) > CURSOR_TOLERANCE_PIXELS
        or abs(cursor.y - expected.y) > CURSOR_TOLERANCE_PIXELS
    ):
        raise DesktopActionFailure(error_code)


async def _settle() -> None:
    await asyncio.sleep(SETTLE_SECONDS)


def _document_locator(offset: tuple[int, int] | None = None) -> ControlLocator:
    values: dict[str, object] = {
        "processName": NOTEPAD_PROCESS,
        "controlType": DOCUMENT_CONTROL_TYPE,
    }
    if offset is not None:
        values["offsetX"] = offset[0]
        values["offsetY"] = offset[1]
    return ControlLocator.model_validate(values)


def _bounds_centre(bounds: ElementBounds) -> ScreenPoint:
    return ScreenPoint(x=bounds.left + bounds.width // 2, y=bounds.top + bounds.height // 2)


def _bounds_record(bounds: ElementBounds) -> list[int]:
    return [bounds.left, bounds.top, bounds.width, bounds.height]


def _probe_offsets(bounds: ElementBounds) -> dict[str, tuple[int, int]]:
    """Derive every probe point from the located control rectangle.

    Using fractions instead of hand-calibrated pixels keeps the probes inside the editor even
    when the control rectangle starts above the text area, which is what failed when the probes
    were anchored to the rectangle's top-left corner.
    """

    return {
        "clickUpper": (
            _at_fraction(bounds.width, CLICK_X_FRACTION),
            _at_fraction(bounds.height, CLICK_UPPER_FRACTION),
        ),
        "clickLower": (
            _at_fraction(bounds.width, CLICK_X_FRACTION),
            _at_fraction(bounds.height, CLICK_LOWER_FRACTION),
        ),
        "dragStart": (
            _at_fraction(bounds.width, DRAG_X_START_FRACTION),
            _at_fraction(bounds.height, DRAG_UPPER_FRACTION),
        ),
        "dragEnd": (
            _at_fraction(bounds.width, DRAG_X_END_FRACTION),
            _at_fraction(bounds.height, DRAG_LOWER_FRACTION),
        ),
        "scrollTop": (
            _at_fraction(bounds.width, SCROLL_X_FRACTION),
            _at_fraction(bounds.height, SCROLL_TOP_FRACTION),
        ),
    }


def _at_fraction(size: int, fraction: float) -> int:
    # The contract limits locator offsets, so clamp instead of sending an invalid argument.
    return max(0, min(round(size * fraction), MAXIMUM_LOCATOR_OFFSET))


def _long_document() -> str:
    """A document taller than the editor viewport with lines wider than the editor.

    Every probe point therefore lands on text: vertical probes always hit some line, and
    horizontal probes stay on the line instead of running past its end.
    """

    filler_width = LONG_DOCUMENT_LINE_WIDTH - len("M0-MOUSE-LINE-00-")
    filler = "Z" * filler_width
    return "\n".join(
        f"M0-MOUSE-LINE-{line:02d}-{filler}" for line in range(1, LONG_DOCUMENT_LINES + 1)
    )


def _marker_character_index(document_text: str, marker: str) -> int:
    position = document_text.find(marker)
    if position < 0:
        raise DesktopActionFailure("MOUSE_CLICK_MARKER_MISSING")
    return position


def _normalize_newlines(text: str) -> str:
    """Compare clipboard text with UIA text despite CR/LF and CRLF differences."""

    return text.replace("\r\n", "\n").replace("\r", "\n")


def _line_ending(text: str) -> str:
    if "\r\n" in text:
        return "crlf"
    if "\r" in text:
        return "cr"
    if "\n" in text:
        return "lf"
    return "none"


def _marker_line_index(document_text: str, marker: str) -> int:
    position = document_text.find(marker)
    if position < 0:
        raise DesktopActionFailure("MOUSE_SCROLL_MARKER_MISSING")
    return document_text.count("\n", 0, position)


async def _require_live_target(
    backend: NotepadMouseSpikeBackend,
    target: WindowTarget,
) -> WindowTarget:
    live_windows = await asyncio.to_thread(
        backend.list_process_windows,
        normalize_process_name(NOTEPAD_PROCESS),
    )
    for window in live_windows:
        if window.handle == target.handle and window.process_id == target.process_id:
            return window
    raise DesktopActionFailure("TARGET_WINDOW_LOST")


async def _require_success(operation: Awaitable[CommandExecutionResult]) -> None:
    result = await operation
    if result.outcome.value != "SUCCEEDED":
        raise DesktopActionFailure(result.error_code or "DESKTOP_ACTION_FAILED")


def _build_report(
    started_at: datetime,
    finished_at: datetime,
    requested_iterations: int,
    environment: dict[str, str | int],
    display: DisplayProfile | None,
    runs: tuple[SpikeIteration, ...],
    setup_error: str | None,
) -> MouseSpikeReport:
    success_count = sum(run.succeeded for run in runs)
    success_rate = success_count / requested_iterations
    errors = Counter(run.error_code for run in runs if run.error_code is not None)
    if setup_error is not None:
        errors[setup_error] += 1
    return MouseSpikeReport(
        started_at=_utc_text(started_at),
        finished_at=_utc_text(finished_at),
        target_process=NOTEPAD_PROCESS,
        requested_iterations=requested_iterations,
        success_count=success_count,
        success_rate=success_rate,
        passed=setup_error is None and success_rate >= PASS_RATE,
        coordinate_mouse_profile=(
            None if display is None else f"{display.width}x{display.height}@{display.dpi}"
        ),
        display_profile=(
            {}
            if display is None
            else {"width": display.width, "height": display.height, "dpi": display.dpi}
        ),
        environment=environment,
        error_counts=dict(sorted(errors.items())),
        runs=runs,
        setup_error=setup_error,
    )


def write_report(report: MouseSpikeReport, artifact_directory: Path) -> Path:
    report_directory = artifact_directory / "reports"
    report_directory.mkdir(parents=True, exist_ok=True)
    timestamp = report.finished_at.replace("-", "").replace(":", "").replace("T", "-")
    timestamp = timestamp.replace(".", "").replace("Z", "")
    destination = report_directory / f"notepad-mouse-spike-{timestamp}.json"
    destination.write_text(f"{report.to_json()}\n", encoding="utf-8")
    return destination


def _error_code(error: Exception, *, fallback: str) -> str:
    return error.code if isinstance(error, DesktopActionFailure) else fallback


def _utc_text(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _iterations_from_environment() -> int:
    raw = os.environ.get("M0_MOUSE_SPIKE_ITERATIONS")
    if raw is None or not raw.strip():
        return SPIKE_ITERATIONS
    try:
        iterations = int(raw)
    except ValueError as error:
        raise ValueError("M0_MOUSE_SPIKE_ITERATIONS must be a positive integer") from error
    if iterations < 1:
        raise ValueError("M0_MOUSE_SPIKE_ITERATIONS must be a positive integer")
    return iterations


def main() -> int:
    if sys.platform != "win32":
        print('{"errorCode":"WINDOWS_REQUIRED"}')
        return 2

    from .windows_backend import PywinautoWindowsBackend

    artifact_directory_text = os.environ.get(
        "AGENT_ARTIFACT_DIR",
        str(DEFAULT_ARTIFACT_DIRECTORY),
    )
    if not artifact_directory_text.strip():
        print('{"errorCode":"INVALID_ARTIFACT_DIRECTORY"}')
        return 2
    try:
        iterations = _iterations_from_environment()
    except ValueError as error:
        print(json.dumps({"errorCode": "INVALID_ITERATIONS", "message": str(error)}))
        return 2

    artifact_directory = Path(artifact_directory_text)
    report = asyncio.run(
        run_notepad_mouse_spike(
            PywinautoWindowsBackend(),
            artifact_directory,
            iterations=iterations,
        )
    )
    destination = write_report(report, artifact_directory)
    print(
        json.dumps(
            {
                "passed": report.passed,
                "successCount": report.success_count,
                "requestedIterations": report.requested_iterations,
                "errorCounts": report.error_counts,
                "report": str(destination),
            },
            ensure_ascii=True,
        )
    )
    return 0 if report.passed else 1

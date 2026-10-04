"""Repeatable Windows M0 mouse smoke test for the guarded desktop executor.

Every iteration drives real pointer input into a freshly launched Notepad window and then
verifies the effect through UIA text reads and clipboard read-back rather than trusting that an
event was delivered:

* ``MOUSE_MOVE`` - the reported pointer position must equal the located control centre.
* ``MOUSE_CLICK`` - the caret must move to the clicked line start, proven by pasting a marker
  and comparing the document text.
* ``MOUSE_DRAG`` - the drag must select text, proven by copying the selection to the clipboard.
* ``MOUSE_CLICK_POSITION`` - the window-relative coordinate path must land on the same caret
  position, and the pointer must be at the computed window-relative point.
* ``MOUSE_SCROLL`` - the first visible line must move, proven by clicking the view top, pasting
  a marker and comparing that marker's line index before and after the wheel action.
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
# Offsets are relative to the located document control, never to the screen. They were
# calibrated against the Notepad text area: just left of the first character on the first line.
CARET_HOME_OFFSET = (4, 8)
DRAG_START_OFFSET = (12, 8)
DRAG_END_OFFSET = (112, 8)
VIEW_TOP_OFFSET = (10, 10)
SCROLL_TICKS = 5
LONG_DOCUMENT_LINES = 60
HOME_MARKER = "["
POSITION_MARKER = "]"
SCROLL_MARKERS = ("@", "#", "$")


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
        try:
            await _run_iteration(executor, backend, iteration, now(), target)
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
) -> None:
    task_id = uuid4()
    expires_at = now + COMMAND_LIFETIME
    document = _document_locator()
    text = f"M0-MOUSE-SPIKE-{iteration:02d}-AAAAAAAAAAAAAAAA"

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

    # Move: the pointer must really end up at the located control centre.
    bounds = await asyncio.to_thread(backend.locate_control, target, document)
    expected_centre = _bounds_centre(bounds)
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
    await _require_cursor(backend, expected_centre, "MOUSE_CURSOR_MISMATCH")

    # Click: place the caret at the start of the first line, then prove it with a marker.
    await _paste(executor, backend, text, task_id, expires_at)
    await _require_success(
        executor.execute(
            MouseClickPayload(
                command_id=uuid4(),
                task_id=task_id,
                expires_at=expires_at,
                action="MOUSE_CLICK",
                arguments=MouseClickArguments(
                    target=_document_locator(offset=CARET_HOME_OFFSET),
                    button=MouseButton.LEFT,
                    click_count=1,
                ),
            ),
            Event(),
        )
    )
    await _insert(executor, backend, HOME_MARKER, task_id, expires_at)
    document_text = await asyncio.to_thread(backend.read_document_text, target)
    if document_text != f"{HOME_MARKER}{text}":
        raise DesktopActionFailure("MOUSE_CLICK_CARET_MISMATCH")

    # Drag: select part of the first line and prove it through the clipboard.
    await _require_success(
        executor.execute(
            MouseDragPayload(
                command_id=uuid4(),
                task_id=task_id,
                expires_at=expires_at,
                action="MOUSE_DRAG",
                arguments=MouseDragArguments(
                    from_control=_document_locator(offset=DRAG_START_OFFSET),
                    to_control=_document_locator(offset=DRAG_END_OFFSET),
                    button=MouseButton.LEFT,
                ),
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
                arguments=InputKeyChordArguments(keys=[InputKey.CTRL, InputKey.C]),
            ),
            Event(),
        )
    )
    selection = await asyncio.to_thread(backend.get_clipboard_text)
    if not selection or selection == HOME_MARKER or selection not in document_text:
        raise DesktopActionFailure("MOUSE_DRAG_SELECTION_MISMATCH")

    await _verify_coordinate_click(executor, backend, target, document, task_id, expires_at, text)
    await _verify_scroll(executor, backend, target, document, task_id, expires_at)

    screenshot = TakeScreenshotPayload(
        command_id=uuid4(),
        task_id=task_id,
        expires_at=expires_at,
        action="TAKE_SCREENSHOT",
        arguments=TakeScreenshotArguments(artifact_name=f"notepad-mouse-{iteration:02d}"),
    )
    await _require_success(executor.execute(screenshot, Event()))


async def _verify_coordinate_click(
    executor: WindowsDesktopActionExecutor,
    backend: NotepadMouseSpikeBackend,
    target: WindowTarget,
    document: ControlLocator,
    task_id: UUID,
    expires_at: datetime,
    text: str,
) -> None:
    """Click at a window-relative coordinate and prove the same caret effect as the click."""

    window_bounds = await asyncio.to_thread(backend.window_bounds, target)
    control_bounds = await asyncio.to_thread(backend.locate_control, target, document)
    relative_x = control_bounds.left - window_bounds.left + CARET_HOME_OFFSET[0]
    relative_y = control_bounds.top - window_bounds.top + CARET_HOME_OFFSET[1]
    await _paste(executor, backend, text, task_id, expires_at)

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
    await _insert(executor, backend, POSITION_MARKER, task_id, expires_at)
    document_text = await asyncio.to_thread(backend.read_document_text, target)
    if document_text != f"{POSITION_MARKER}{text}":
        raise DesktopActionFailure("COORDINATE_CLICK_CARET_MISMATCH")


async def _verify_scroll(
    executor: WindowsDesktopActionExecutor,
    backend: NotepadMouseSpikeBackend,
    target: WindowTarget,
    document: ControlLocator,
    task_id: UUID,
    expires_at: datetime,
) -> None:
    """Prove that a wheel action moves the visible text, using marker line indices.

    Pasting the long document leaves the caret, and therefore the view, at the bottom, so the
    first wheel action scrolls up and the second returns to the bottom.
    """

    await _paste(executor, backend, _long_document(), task_id, expires_at)
    bottom_line = await _click_and_mark(
        executor, backend, target, task_id, expires_at, SCROLL_MARKERS[0]
    )
    await _scroll(executor, document, task_id, expires_at, SCROLL_TICKS)
    scrolled_up = await _click_and_mark(
        executor, backend, target, task_id, expires_at, SCROLL_MARKERS[1]
    )
    if scrolled_up >= bottom_line:
        raise DesktopActionFailure("MOUSE_SCROLL_UP_NOT_OBSERVED")

    await _scroll(executor, document, task_id, expires_at, -SCROLL_TICKS)
    scrolled_down = await _click_and_mark(
        executor, backend, target, task_id, expires_at, SCROLL_MARKERS[2]
    )
    if scrolled_down <= scrolled_up:
        raise DesktopActionFailure("MOUSE_SCROLL_DOWN_NOT_OBSERVED")


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


async def _click_and_mark(
    executor: WindowsDesktopActionExecutor,
    backend: NotepadMouseSpikeBackend,
    target: WindowTarget,
    task_id: UUID,
    expires_at: datetime,
    marker: str,
) -> int:
    """Click the visible top-left of the text area, mark it, and return the marker's line index."""

    result = await executor.execute(
        MouseClickPayload(
            command_id=uuid4(),
            task_id=task_id,
            expires_at=expires_at,
            action="MOUSE_CLICK",
            arguments=MouseClickArguments(
                target=_document_locator(offset=VIEW_TOP_OFFSET),
                button=MouseButton.LEFT,
                click_count=1,
            ),
        ),
        Event(),
    )
    if result.outcome.value != "SUCCEEDED":
        raise DesktopActionFailure(result.error_code or "MOUSE_CLICK_FAILED")

    await _insert(executor, backend, marker, task_id, expires_at)
    document_text = await asyncio.to_thread(backend.read_document_text, target)
    return _marker_line_index(document_text, marker)


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


def _long_document() -> str:
    return "\n".join(
        f"M0-MOUSE-LINE-{line:02d}-ZZZZZZZZZZZZZZZZ" for line in range(1, LONG_DOCUMENT_LINES + 1)
    )


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

"""Repeatable Windows M0 smoke test for the guarded desktop executor."""

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
from uuid import uuid4

from .config import DEFAULT_ARTIFACT_DIRECTORY
from .execution import CommandExecutionResult
from .protocol import (
    ClipboardSetTextArguments,
    ClipboardSetTextPayload,
    InputKey,
    InputKeyChordArguments,
    InputKeyChordPayload,
    TakeScreenshotArguments,
    TakeScreenshotPayload,
    WindowActivateArguments,
    WindowActivatePayload,
)
from .windows_executor import (
    DesktopActionFailure,
    WindowsBackend,
    WindowsDesktopActionExecutor,
    WindowTarget,
    normalize_process_name,
)

SPIKE_ITERATIONS = 20
PASS_RATE = 0.95
NOTEPAD_PROCESS = "notepad.exe"
COMMAND_LIFETIME = timedelta(minutes=1)
TEXT_VERIFICATION_TIMEOUT_SECONDS = 2.0
TEXT_VERIFICATION_INTERVAL_SECONDS = 0.1


class NotepadSpikeBackend(WindowsBackend, Protocol):
    def start_notepad(self) -> str | None:
        """Launch notepad.exe and return the title of the window it created, if known."""

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
class SpikeReport:
    started_at: str
    finished_at: str
    target_process: str
    requested_iterations: int
    success_count: int
    success_rate: float
    passed: bool
    environment: dict[str, str | int]
    error_counts: dict[str, int]
    runs: tuple[SpikeIteration, ...]
    setup_error: str | None = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=True, indent=2)


async def run_notepad_spike(
    backend: NotepadSpikeBackend,
    artifact_directory: Path,
    *,
    iterations: int = SPIKE_ITERATIONS,
    clock: Callable[[], datetime] | None = None,
    text_verification_timeout: float = TEXT_VERIFICATION_TIMEOUT_SECONDS,
    text_verification_interval: float = TEXT_VERIFICATION_INTERVAL_SECONDS,
) -> SpikeReport:
    if iterations < 1:
        raise ValueError("Spike iterations must be positive")
    if text_verification_timeout < 0 or text_verification_interval <= 0:
        raise ValueError("Text verification timeout must be non-negative and interval positive")

    now = clock or (lambda: datetime.now(UTC))
    started_at = now()
    environment: dict[str, str | int] = {}
    window_title: str | None = None
    try:
        environment = await asyncio.to_thread(backend.environment_metadata)
        window_title = await asyncio.to_thread(backend.start_notepad)
    except Exception as error:
        return _build_report(
            started_at,
            now(),
            iterations,
            environment,
            (),
            _error_code(error, fallback="SPIKE_SETUP_FAILED"),
        )

    executor = WindowsDesktopActionExecutor(
        backend,
        allowed_processes=frozenset({NOTEPAD_PROCESS}),
        artifact_directory=artifact_directory,
    )
    runs: list[SpikeIteration] = []

    for iteration in range(1, iterations + 1):
        run_started = perf_counter()
        error_code: str | None = None
        try:
            await _run_iteration(
                executor,
                backend,
                iteration,
                now(),
                text_verification_timeout,
                text_verification_interval,
                window_title,
            )
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
        tuple(runs),
        None,
    )


async def _run_iteration(
    executor: WindowsDesktopActionExecutor,
    backend: NotepadSpikeBackend,
    iteration: int,
    now: datetime,
    text_verification_timeout: float,
    text_verification_interval: float,
    window_title: str | None,
) -> None:
    task_id = uuid4()
    text = f"M0-NOTEPAD-SPIKE-{iteration:02d}"
    expires_at = now + COMMAND_LIFETIME

    await _require_success(
        executor.execute(
            WindowActivatePayload(
                command_id=uuid4(),
                task_id=task_id,
                expires_at=expires_at,
                action="WINDOW_ACTIVATE",
                arguments=WindowActivateArguments(
                    process_name=NOTEPAD_PROCESS,
                    title_contains=window_title,
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
                arguments=InputKeyChordArguments(keys=[InputKey.CTRL, InputKey.A]),
            ),
            Event(),
        )
    )
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
    target = await asyncio.to_thread(
        backend.find_window,
        normalize_process_name(NOTEPAD_PROCESS),
        window_title,
    )
    clipboard_text = await asyncio.to_thread(backend.get_clipboard_text)
    if clipboard_text != text:
        raise DesktopActionFailure("CLIPBOARD_VERIFICATION_FAILED")
    if not await _wait_for_document_text(
        backend,
        target,
        text,
        text_verification_timeout,
        text_verification_interval,
    ):
        raise DesktopActionFailure("TEXT_VERIFICATION_FAILED")

    screenshot = TakeScreenshotPayload(
        command_id=uuid4(),
        task_id=task_id,
        expires_at=expires_at,
        action="TAKE_SCREENSHOT",
        arguments=TakeScreenshotArguments(artifact_name=f"notepad-spike-{iteration:02d}"),
    )
    await _require_success(executor.execute(screenshot, Event()))


async def _wait_for_document_text(
    backend: NotepadSpikeBackend,
    target: WindowTarget,
    expected: str,
    timeout: float,
    interval: float,
) -> bool:
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        document_text = await asyncio.to_thread(backend.read_document_text, target)
        if expected in document_text:
            return True
        if asyncio.get_running_loop().time() >= deadline:
            return False
        await asyncio.sleep(interval)


async def _require_success(
    operation: Awaitable[CommandExecutionResult],
) -> None:
    result = await operation
    if result.outcome.value != "SUCCEEDED":
        raise DesktopActionFailure(result.error_code or "DESKTOP_ACTION_FAILED")


def _build_report(
    started_at: datetime,
    finished_at: datetime,
    requested_iterations: int,
    environment: dict[str, str | int],
    runs: tuple[SpikeIteration, ...],
    setup_error: str | None,
) -> SpikeReport:
    success_count = sum(run.succeeded for run in runs)
    success_rate = success_count / requested_iterations
    errors = Counter(run.error_code for run in runs if run.error_code is not None)
    if setup_error is not None:
        errors[setup_error] += 1
    return SpikeReport(
        started_at=_utc_text(started_at),
        finished_at=_utc_text(finished_at),
        target_process=NOTEPAD_PROCESS,
        requested_iterations=requested_iterations,
        success_count=success_count,
        success_rate=success_rate,
        passed=setup_error is None and success_rate >= PASS_RATE,
        environment=environment,
        error_counts=dict(sorted(errors.items())),
        runs=runs,
        setup_error=setup_error,
    )


def write_report(report: SpikeReport, artifact_directory: Path) -> Path:
    report_directory = artifact_directory / "reports"
    report_directory.mkdir(parents=True, exist_ok=True)
    timestamp = report.finished_at.replace("-", "").replace(":", "").replace("T", "-")
    timestamp = timestamp.replace(".", "").replace("Z", "")
    destination = report_directory / f"notepad-spike-{timestamp}.json"
    destination.write_text(f"{report.to_json()}\n", encoding="utf-8")
    return destination


def _error_code(error: Exception, *, fallback: str) -> str:
    return error.code if isinstance(error, DesktopActionFailure) else fallback


def _utc_text(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


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
    artifact_directory = Path(artifact_directory_text)
    report = asyncio.run(
        run_notepad_spike(
            PywinautoWindowsBackend(),
            artifact_directory,
        )
    )
    destination = write_report(report, artifact_directory)
    print(
        json.dumps(
            {
                "passed": report.passed,
                "successCount": report.success_count,
                "requestedIterations": report.requested_iterations,
                "report": str(destination),
            },
            ensure_ascii=True,
        )
    )
    return 0 if report.passed else 1

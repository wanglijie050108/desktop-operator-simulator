from __future__ import annotations

import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

from desktop_agent.notepad_spike import (
    NOTEPAD_PROCESS,
    NotepadSpikeBackend,
    main,
    run_notepad_spike,
    write_report,
)
from desktop_agent.windows_executor import WindowTarget

NOW = datetime(2026, 9, 28, 4, 0, tzinfo=UTC)
TARGET = WindowTarget(123, 456, "notepad", "Untitled - Notepad")


class FakeSpikeBackend(NotepadSpikeBackend):
    def __init__(self, *, setup_error: Exception | None = None) -> None:
        self.setup_error = setup_error
        self.started = 0
        self.foreground = True
        self.clipboard = ""
        self.document = ""
        self.keys: list[str] = []
        self.screenshots: list[Path] = []
        self.release_count = 0
        self.chat_text: tuple[WindowTarget, str] | None = None

    def start_notepad(self) -> None:
        self.started += 1
        if self.setup_error is not None:
            raise self.setup_error

    def find_window(self, process_name: str, title_contains: str | None) -> WindowTarget:
        assert process_name == NOTEPAD_PROCESS.removesuffix(".exe")
        assert title_contains is None
        return TARGET

    def activate(self, target: WindowTarget) -> None:
        assert target == TARGET
        self.foreground = True

    def is_foreground(self, target: WindowTarget) -> bool:
        return self.foreground and target == TARGET

    def set_clipboard_text(self, text: str) -> None:
        self.clipboard = text

    def get_clipboard_text(self) -> str:
        return self.clipboard

    def send_keys(self, keys: str) -> None:
        self.keys.append(keys)
        if keys == "^a":
            self.document = ""
        elif keys == "^v":
            self.document = self.clipboard

    def capture_window(self, target: WindowTarget, destination: Path) -> None:
        assert target == TARGET
        self.screenshots.append(destination)

    def read_document_text(self, target: WindowTarget) -> str:
        assert target == TARGET
        return self.document

    def release_inputs(self) -> None:
        self.release_count += 1

    def send_chat_text(self, target: WindowTarget, text: str) -> None:
        self.chat_text = (target, text)

    def environment_metadata(self) -> dict[str, str | int]:
        return {
            "os": "Windows-11-test",
            "python": "3.11.test",
            "pywinauto": "0.6.9",
            "screenWidth": 1920,
            "screenHeight": 1080,
            "dpi": 96,
        }


class BadTextSpikeBackend(FakeSpikeBackend):
    def read_document_text(self, target: WindowTarget) -> str:
        return "unexpected"


class OneFailureSpikeBackend(FakeSpikeBackend):
    def capture_window(self, target: WindowTarget, destination: Path) -> None:
        if not self.screenshots:
            self.screenshots.append(destination)
            raise RuntimeError("synthetic capture failure")
        super().capture_window(target, destination)


class MetadataFailureSpikeBackend(FakeSpikeBackend):
    def environment_metadata(self) -> dict[str, str | int]:
        raise RuntimeError("metadata unavailable")


@pytest.mark.asyncio
async def test_runs_each_notepad_iteration_and_passes_threshold(tmp_path: Path) -> None:
    backend = FakeSpikeBackend()

    report = await run_notepad_spike(
        backend,
        tmp_path,
        iterations=3,
        clock=lambda: NOW,
    )

    assert report.passed
    assert report.success_count == 3
    assert report.success_rate == 1
    assert report.setup_error is None
    assert backend.started == 1
    assert backend.release_count == 3
    assert backend.keys == ["^a", "^v"] * 3
    assert len(backend.screenshots) == 3
    assert all(run.succeeded for run in report.runs)
    assert "M0-NOTEPAD-SPIKE" not in report.to_json()


@pytest.mark.asyncio
async def test_records_setup_failure_without_claiming_iterations(tmp_path: Path) -> None:
    backend = FakeSpikeBackend(setup_error=RuntimeError("local details"))

    report = await run_notepad_spike(
        backend,
        tmp_path,
        iterations=20,
        clock=lambda: NOW,
    )

    assert not report.passed
    assert report.success_count == 0
    assert report.runs == ()
    assert report.setup_error == "SPIKE_SETUP_FAILED"
    assert report.error_counts == {"SPIKE_SETUP_FAILED": 1}


@pytest.mark.asyncio
async def test_records_environment_metadata_failure(tmp_path: Path) -> None:
    report = await run_notepad_spike(
        MetadataFailureSpikeBackend(),
        tmp_path,
        clock=lambda: NOW,
    )

    assert not report.passed
    assert report.environment == {}
    assert report.setup_error == "SPIKE_SETUP_FAILED"


@pytest.mark.asyncio
async def test_records_verification_failure_and_continues(tmp_path: Path) -> None:
    backend = BadTextSpikeBackend()
    report = await run_notepad_spike(
        backend,
        tmp_path,
        iterations=2,
        clock=lambda: NOW,
        text_verification_timeout=0,
    )

    assert not report.passed
    assert report.success_count == 0
    assert report.error_counts == {"TEXT_VERIFICATION_FAILED": 2}
    assert backend.release_count == 2


@pytest.mark.asyncio
async def test_accepts_nineteen_of_twenty_runs(tmp_path: Path) -> None:
    report = await run_notepad_spike(
        OneFailureSpikeBackend(),
        tmp_path,
        iterations=20,
        clock=lambda: NOW,
    )

    assert report.passed
    assert report.success_count == 19
    assert report.success_rate == 0.95
    assert report.error_counts == {"DESKTOP_ACTION_FAILED": 1}


@pytest.mark.asyncio
async def test_rejects_invalid_iteration_count(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="iterations"):
        await run_notepad_spike(
            FakeSpikeBackend(),
            tmp_path,
            iterations=0,
        )
    with pytest.raises(ValueError, match="verification"):
        await run_notepad_spike(
            FakeSpikeBackend(),
            tmp_path,
            text_verification_interval=0,
        )


def test_writes_report_without_test_content(tmp_path: Path) -> None:
    backend = FakeSpikeBackend()
    report = asyncio.run(run_notepad_spike(backend, tmp_path, iterations=1, clock=lambda: NOW))

    destination = write_report(report, tmp_path)
    saved = json.loads(destination.read_text(encoding="utf-8"))

    assert destination.parent == tmp_path / "reports"
    assert saved["success_count"] == 1
    assert saved["requested_iterations"] == 1
    assert "M0-NOTEPAD-SPIKE" not in destination.read_text(encoding="utf-8")


def test_cli_fails_closed_outside_windows(capsys: pytest.CaptureFixture[str]) -> None:
    if sys.platform == "win32":
        pytest.skip("Non-Windows guard is only applicable off Windows")

    assert main() == 2
    assert json.loads(capsys.readouterr().out) == {"errorCode": "WINDOWS_REQUIRED"}

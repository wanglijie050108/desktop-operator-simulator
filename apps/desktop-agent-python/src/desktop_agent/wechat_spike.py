"""Repeatable Windows M0 WeChat send/read-back spike.

The spike answers one question before any live ingestion is enabled: can the target WeChat
build be driven *and read back* deterministically? Every iteration sends a unique probe text
into an explicitly confirmed test conversation and then waits until that exact text appears in
the visible UIA control tree.

Safety properties are deliberate:

* No input is injected unless ``WECHAT_SPIKE_CONFIRM=1`` is set.
* The conversation title locator must be configured from a prior read-only inspection. Until
  then the tool refuses to run, so an uncalibrated build cannot send to a real contact.
* The conversation is verified before activation and again immediately before sending. A
  title change aborts the iteration with no message sent.
* The report stores only a hash and length of the conversation label; probe text exists only
  in memory and is never written to disk.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import secrets
import sys
import unicodedata
from collections import Counter
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Protocol

from .config import DEFAULT_ARTIFACT_DIRECTORY
from .uia_inspection import RawUiaControlNode
from .windows_executor import DesktopActionFailure, WindowTarget, normalize_process_name

WECHAT_PROCESS = "Weixin.exe"
SPIKE_ITERATIONS = 20
PASS_RATE = 0.90
MAXIMUM_CONTROL_NODES = 4_000
MAXIMUM_CONVERSATION_LENGTH = 500
MAXIMUM_SPIKE_ITERATIONS = 100
READBACK_TIMEOUT_SECONDS = 6.0
READBACK_INTERVAL_SECONDS = 0.25
ALLOWED_WECHAT_PROCESSES = frozenset({"wechat", "weixin"})
_PROCESS_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
_PROBE_TEXT_PREFIX = "【HOS-SPIKE】"


class WeChatSpikeBackend(Protocol):
    """Minimal backend surface required by the send/read-back spike."""

    def find_window(self, process_name: str, title_contains: str | None) -> WindowTarget: ...

    def activate(self, target: WindowTarget) -> None: ...

    def is_foreground(self, target: WindowTarget) -> bool: ...

    def collect_control_tree(
        self,
        target: WindowTarget,
        maximum_nodes: int,
    ) -> tuple[list[RawUiaControlNode], bool]: ...

    def send_chat_text(self, target: WindowTarget, text: str) -> None: ...

    def release_inputs(self) -> None: ...

    def environment_metadata(self) -> dict[str, str | int]: ...


@dataclass(frozen=True, slots=True)
class ConversationTitleLocator:
    """How to find the active conversation title control in the WeChat UIA tree.

    Exactly one of ``automation_id`` and ``class_name`` must be configured. The automation-id
    strategy requires a unique visible match; the class-name strategy selects the ``ordinal``
    visible match in tree order, which supports builds that expose class names but no ids.
    """

    automation_id: str | None = None
    class_name: str | None = None
    ordinal: int = 1

    def __post_init__(self) -> None:
        if (self.automation_id is None) == (self.class_name is None):
            raise ValueError("Configure exactly one conversation title locator")
        if self.ordinal < 1:
            raise ValueError("Conversation title ordinal must be positive")


@dataclass(frozen=True, slots=True)
class WeChatSpikeOptions:
    process_name: str
    expected_conversation: str
    title_locator: ConversationTitleLocator
    confirmed: bool
    iterations: int
    artifact_directory: Path


@dataclass(frozen=True, slots=True)
class WeChatSpikeIteration:
    iteration: int
    succeeded: bool
    duration_ms: int
    error_code: str | None
    observed_matches: int


@dataclass(frozen=True, slots=True)
class WeChatSpikeReport:
    started_at: str
    finished_at: str
    target_process: str
    expected_conversation_hash: str
    expected_conversation_length: int
    requested_iterations: int
    success_count: int
    success_rate: float
    passed: bool
    environment: dict[str, str | int]
    error_counts: dict[str, int]
    runs: tuple[WeChatSpikeIteration, ...]
    setup_error: str | None = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=True, indent=2)


def load_wechat_spike_options(
    environment: Mapping[str, str] | None = None,
) -> WeChatSpikeOptions:
    values = os.environ if environment is None else environment
    process_name = _validate_process_name(values.get("WECHAT_PROCESS_NAME", WECHAT_PROCESS))

    expected_conversation = (values.get("WECHAT_EXPECTED_CONVERSATION") or "").strip()
    if not 1 <= len(expected_conversation) <= MAXIMUM_CONVERSATION_LENGTH:
        raise ValueError(
            "WECHAT_EXPECTED_CONVERSATION must contain 1 to "
            f"{MAXIMUM_CONVERSATION_LENGTH} characters",
        )

    automation_id = (values.get("WECHAT_SPIKE_TITLE_AUTOMATION_ID") or "").strip() or None
    class_name = (values.get("WECHAT_SPIKE_TITLE_CLASS_NAME") or "").strip() or None
    ordinal_text = (values.get("WECHAT_SPIKE_TITLE_ORDINAL") or "1").strip()
    try:
        ordinal = int(ordinal_text)
    except ValueError:
        raise ValueError("WECHAT_SPIKE_TITLE_ORDINAL must be an integer") from None
    if ordinal < 1:
        raise ValueError("WECHAT_SPIKE_TITLE_ORDINAL must be positive")
    if (automation_id is None) == (class_name is None):
        raise ValueError(
            "Configure exactly one of WECHAT_SPIKE_TITLE_AUTOMATION_ID or "
            "WECHAT_SPIKE_TITLE_CLASS_NAME",
        )

    iterations_text = (values.get("WECHAT_SPIKE_ITERATIONS") or str(SPIKE_ITERATIONS)).strip()
    try:
        iterations = int(iterations_text)
    except ValueError:
        raise ValueError("WECHAT_SPIKE_ITERATIONS must be an integer") from None
    if not 1 <= iterations <= MAXIMUM_SPIKE_ITERATIONS:
        raise ValueError(
            f"WECHAT_SPIKE_ITERATIONS must be between 1 and {MAXIMUM_SPIKE_ITERATIONS}",
        )

    artifact_text = values.get("AGENT_ARTIFACT_DIR", str(DEFAULT_ARTIFACT_DIRECTORY))
    if not artifact_text.strip():
        raise ValueError("AGENT_ARTIFACT_DIR must not be empty")

    return WeChatSpikeOptions(
        process_name=process_name,
        expected_conversation=expected_conversation,
        title_locator=ConversationTitleLocator(
            automation_id=automation_id,
            class_name=class_name,
            ordinal=ordinal,
        ),
        confirmed=(values.get("WECHAT_SPIKE_CONFIRM") or "").strip() == "1",
        iterations=iterations,
        artifact_directory=Path(artifact_text),
    )


def resolve_conversation_title(
    nodes: list[RawUiaControlNode] | tuple[RawUiaControlNode, ...],
    locator: ConversationTitleLocator,
) -> str | None:
    """Return the active conversation label, or ``None`` when it cannot be resolved uniquely."""
    if locator.automation_id is not None:
        matches = [
            node
            for node in nodes
            if node.visible and node.automation_id == locator.automation_id and node.name.strip()
        ]
        if len(matches) != 1:
            return None
        return matches[0].name.strip()

    matches = [
        node
        for node in nodes
        if node.visible and node.class_name == locator.class_name and node.name.strip()
    ]
    if len(matches) < locator.ordinal:
        return None
    return matches[locator.ordinal - 1].name.strip()


def count_visible_matches(
    nodes: list[RawUiaControlNode] | tuple[RawUiaControlNode, ...],
    expected: str,
) -> int:
    """Count visible nodes whose text contains the normalized probe text."""
    needle = _normalize(expected)
    return sum(1 for node in nodes if node.visible and needle in _normalize(node.name))


async def run_wechat_spike(
    backend: WeChatSpikeBackend,
    options: WeChatSpikeOptions,
    *,
    clock: Callable[[], datetime] | None = None,
    readback_timeout: float = READBACK_TIMEOUT_SECONDS,
    readback_interval: float = READBACK_INTERVAL_SECONDS,
) -> WeChatSpikeReport:
    if options.iterations < 1:
        raise ValueError("Spike iterations must be positive")
    if readback_timeout < 0 or readback_interval <= 0:
        raise ValueError("Read-back timeout must be non-negative and interval positive")

    now = clock or (lambda: datetime.now(UTC))
    started_at = now()
    environment: dict[str, str | int] = {}

    if not options.confirmed:
        return _build_report(
            started_at,
            now(),
            options,
            environment,
            (),
            "SPIKE_CONFIRMATION_REQUIRED",
        )

    try:
        environment = await asyncio.to_thread(backend.environment_metadata)
        target = await asyncio.to_thread(backend.find_window, options.process_name, None)
        await _verify_conversation(backend, target, options)
    except DesktopActionFailure as error:
        return _build_report(started_at, now(), options, environment, (), error.code)
    except Exception:
        return _build_report(
            started_at,
            now(),
            options,
            environment,
            (),
            "SPIKE_SETUP_FAILED",
        )

    runs: list[WeChatSpikeIteration] = []
    for iteration in range(1, options.iterations + 1):
        run_started = perf_counter()
        error_code: str | None = None
        observed_matches = 0
        probe_text = _build_probe_text(iteration)
        try:
            await asyncio.to_thread(backend.activate, target)
            if not await asyncio.to_thread(backend.is_foreground, target):
                raise DesktopActionFailure("TARGET_WINDOW_NOT_FOREGROUND")

            try:
                await _verify_conversation(backend, target, options)
            except DesktopActionFailure as error:
                if error.code == "CONVERSATION_MISMATCH":
                    raise DesktopActionFailure("CONVERSATION_CHANGED") from error
                raise

            await asyncio.to_thread(backend.send_chat_text, target, probe_text)
            observed_matches = await _wait_for_echo(
                backend,
                target,
                probe_text,
                readback_timeout,
                readback_interval,
            )
            if observed_matches == 0:
                raise DesktopActionFailure("MESSAGE_NOT_OBSERVED")
        except DesktopActionFailure as error:
            error_code = error.code
        except Exception:
            error_code = "SPIKE_UNEXPECTED_ERROR"
        finally:
            try:
                await asyncio.to_thread(backend.release_inputs)
            except Exception:
                error_code = error_code or "INPUT_RELEASE_FAILED"

        runs.append(
            WeChatSpikeIteration(
                iteration=iteration,
                succeeded=error_code is None,
                duration_ms=max(0, round((perf_counter() - run_started) * 1_000)),
                error_code=error_code,
                observed_matches=observed_matches,
            )
        )

    return _build_report(started_at, now(), options, environment, tuple(runs), None)


async def _verify_conversation(
    backend: WeChatSpikeBackend,
    target: WindowTarget,
    options: WeChatSpikeOptions,
) -> None:
    nodes, _ = await asyncio.to_thread(
        backend.collect_control_tree,
        target,
        MAXIMUM_CONTROL_NODES,
    )
    label = resolve_conversation_title(nodes, options.title_locator)
    if label is None:
        raise DesktopActionFailure("CONVERSATION_TITLE_NOT_FOUND")
    if _normalize(label) != _normalize(options.expected_conversation):
        raise DesktopActionFailure("CONVERSATION_MISMATCH")


async def _wait_for_echo(
    backend: WeChatSpikeBackend,
    target: WindowTarget,
    probe_text: str,
    timeout: float,
    interval: float,
) -> int:
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        nodes, _ = await asyncio.to_thread(
            backend.collect_control_tree,
            target,
            MAXIMUM_CONTROL_NODES,
        )
        matches = count_visible_matches(nodes, probe_text)
        if matches > 0:
            return matches
        if asyncio.get_running_loop().time() >= deadline:
            return 0
        await asyncio.sleep(interval)


def _build_probe_text(iteration: int) -> str:
    # Unique per iteration so a stale message from an earlier run cannot satisfy read-back.
    return f"{_PROBE_TEXT_PREFIX}{iteration:02d}-{secrets.token_hex(3)}"


def _build_report(
    started_at: datetime,
    finished_at: datetime,
    options: WeChatSpikeOptions,
    environment: dict[str, str | int],
    runs: tuple[WeChatSpikeIteration, ...],
    setup_error: str | None,
) -> WeChatSpikeReport:
    success_count = sum(run.succeeded for run in runs)
    success_rate = success_count / options.iterations
    errors = Counter(run.error_code for run in runs if run.error_code is not None)
    if setup_error is not None:
        errors[setup_error] += 1
    return WeChatSpikeReport(
        started_at=_utc_text(started_at),
        finished_at=_utc_text(finished_at),
        target_process=options.process_name,
        expected_conversation_hash=_digest(options.expected_conversation),
        expected_conversation_length=len(options.expected_conversation),
        requested_iterations=options.iterations,
        success_count=success_count,
        success_rate=success_rate,
        passed=setup_error is None and success_rate >= PASS_RATE,
        environment=environment,
        error_counts=dict(sorted(errors.items())),
        runs=runs,
        setup_error=setup_error,
    )


def write_report(report: WeChatSpikeReport, artifact_directory: Path) -> Path:
    report_directory = artifact_directory / "reports"
    report_directory.mkdir(parents=True, exist_ok=True)
    timestamp = report.finished_at.replace("-", "").replace(":", "").replace("T", "-")
    timestamp = timestamp.replace(".", "").replace("Z", "")
    destination = report_directory / f"wechat-spike-{timestamp}.json"
    destination.write_text(f"{report.to_json()}\n", encoding="utf-8")
    return destination


def _validate_process_name(value: str) -> str:
    if (
        Path(value).name != value
        or _PROCESS_NAME_PATTERN.fullmatch(value) is None
        or "\\" in value
        or "/" in value
    ):
        raise ValueError("WECHAT_PROCESS_NAME must be a pure process name")
    normalized = normalize_process_name(value)
    if normalized not in ALLOWED_WECHAT_PROCESSES:
        raise ValueError("WECHAT_PROCESS_NAME is not an allowed WeChat process")
    return normalized


def _normalize(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip()


def _digest(value: str) -> str:
    return hashlib.sha256(_normalize(value).encode()).hexdigest()


def _utc_text(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def main() -> int:
    if sys.platform != "win32":
        print('{"errorCode":"WINDOWS_REQUIRED"}')
        return 2

    try:
        options = load_wechat_spike_options()
    except ValueError:
        print('{"errorCode":"INVALID_SPIKE_CONFIGURATION"}')
        return 2

    from .windows_backend import PywinautoWindowsBackend

    report = asyncio.run(run_wechat_spike(PywinautoWindowsBackend(), options))
    destination = write_report(report, options.artifact_directory)
    print(
        json.dumps(
            {
                "passed": report.passed,
                "successCount": report.success_count,
                "requestedIterations": report.requested_iterations,
                "setupError": report.setup_error,
                "report": str(destination),
            },
            ensure_ascii=True,
        )
    )
    return 0 if report.passed else 1

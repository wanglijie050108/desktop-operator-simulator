"""Bounded, failure-tolerant control-tree collection for ``DESKTOP_INSPECT_TREE``.

Design notes that the caller depends on:

- **No UIA call is unbounded.** A window whose UI thread is busy, deadlocked, or still
  starting up makes a single UI Automation call hang for minutes, which would consume the
  whole task's wall-clock budget in one observation. Every traversal step therefore runs
  under a per-call timeout; on expiry the *window* is abandoned and reported as a failed
  capture while the rest of the request still finishes.
- **Excluded processes are never entered.** The accessibility provider of some
  applications (editors, terminals) can stall traversal, so a window is filtered by
  process name *before* any UIA call touches it.
- **Truncation is explicit.** Descending stops as soon as the node budget is spent, and
  ``truncated`` is reported so the Control Server records a shortened observation rather
  than silently treating a partial tree as complete.
- **Text is sanitized, not redacted.** Redaction to HMAC tokens is the Control Server's
  job. This module only guarantees that the strings it emits have no lone surrogates,
  private-use characters, or control/bidi characters.
"""

from __future__ import annotations

import re
from collections import deque
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from functools import partial
from pathlib import PureWindowsPath
from typing import TYPE_CHECKING, Any, Protocol

from .observation_text import sanitize_observation_text

if TYPE_CHECKING:
    # The executor imports this module to drive traversal, so importing its types at module
    # scope would form an import cycle. They are only needed for annotations, which
    # ``from __future__ import annotations`` keeps unevaluated at runtime.
    from .windows_executor import WindowTarget

DEFAULT_MAX_NODES = 1_000
DEFAULT_MAX_DEPTH = 50
DEFAULT_OPERATION_TIMEOUT_MS = 5_000
MAXIMUM_TEXT_LENGTH = 200
_PROCESS_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")


def _normalize_process_name(name: str) -> str:
    """Case-fold a process name and drop a trailing ``.exe``.

    Deliberately duplicated from ``windows_executor`` rather than imported: this module is
    imported by the executor, and the production call passes an already-normalized name, so
    the only cost is a few duplicated lines in exchange for no import cycle.
    """

    basename = PureWindowsPath(name).name.casefold()
    return basename[:-4] if basename.endswith(".exe") else basename


@dataclass(frozen=True, slots=True)
class RawControlNode:
    """One UIA control, flattened with its depth.

    ``depth`` rather than a nested tree keeps the payload small and lets the Control
    Server rebuild whatever shape it needs.
    """

    depth: int
    control_type: str
    automation_id: str
    name: str
    enabled: bool
    visible: bool


@dataclass(frozen=True, slots=True)
class ControlTreeCapture:
    process_name: str
    process_id: int
    window_handle: int
    window_title: str
    nodes: tuple[RawControlNode, ...]
    truncated: bool
    timed_out: bool
    """True when a UIA call exceeded the timeout and the window was abandoned."""


class InspectionBackend(Protocol):
    def list_process_windows(self, process_name: str) -> tuple[WindowTarget, ...]: ...


def normalize_excluded_processes(values: Iterable[str] | None) -> frozenset[str]:
    """Validate the excluded-process list into normalized basenames.

    Matching is case-insensitive and exact, with no wildcards or regular expressions, so a
    misconfigured entry can never silently exclude an unrelated application.
    """

    if not values:
        return frozenset()
    normalized: set[str] = set()
    for value in values:
        name = value.strip()
        if not name:
            continue
        if _PROCESS_NAME_PATTERN.fullmatch(name) is None:
            raise ValueError(f"Invalid excluded process name '{name}'")
        normalized.add(_normalize_process_name(name))
    return frozenset(normalized)


def resolve_inspection_limits(
    *,
    max_nodes: int | None,
    max_depth: int | None,
    timeout_ms: int | None,
) -> tuple[int, int, int]:
    """Apply defaults and reject out-of-contract values instead of guessing."""

    resolved_nodes = DEFAULT_MAX_NODES if max_nodes is None else max_nodes
    resolved_depth = DEFAULT_MAX_DEPTH if max_depth is None else max_depth
    resolved_timeout = DEFAULT_OPERATION_TIMEOUT_MS if timeout_ms is None else timeout_ms
    if not 1 <= resolved_nodes <= 20_000:
        raise ValueError("maxNodes must be between 1 and 20000")
    if not 1 <= resolved_depth <= 100:
        raise ValueError("maxDepth must be between 1 and 100")
    if not 1 <= resolved_timeout <= 30_000:
        raise ValueError("timeoutMs must be between 1 and 30000")
    return resolved_nodes, resolved_depth, resolved_timeout


class _TimeoutGuard:
    """Runs one blocking UIA call under a timeout on a reusable worker thread.

    A dedicated single-thread executor is used instead of ``concurrent.futures.wait``
    with a fresh pool per call because UIA wrappers are thread-affine on some providers
    and because creating a pool per node would dominate the capture cost. When a call
    times out the worker is abandoned; the executor is shut down without waiting so a
    stuck thread cannot block the command handler.
    """

    def __init__(self, timeout_seconds: float) -> None:
        self._timeout = timeout_seconds
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="uia-observe")
        self._broken = False

    def __enter__(self) -> _TimeoutGuard:
        return self

    def __exit__(self, *_: object) -> None:
        # cancel_futures only drops queued work; a hung running call keeps its thread.
        self._executor.shutdown(wait=False, cancel_futures=True)

    def call(self, function: Callable[[], Any]) -> Any:
        if self._broken:
            raise TimeoutError("A previous UI Automation call timed out")
        future = self._executor.submit(function)
        try:
            return future.result(timeout=self._timeout)
        except FutureTimeoutError:
            self._broken = True
            future.cancel()
            raise


def collect_control_tree(
    backend: InspectionBackend,
    process_name: str,
    title_contains: str | None,
    *,
    max_nodes: int,
    max_depth: int,
    timeout_ms: int,
    excluded_processes: frozenset[str] = frozenset(),
    window_factory: Callable[[WindowTarget], Any],
) -> ControlTreeCapture:
    """Collect the control tree of exactly one allowlisted window.

    Raises ``LookupError`` when the window cannot be resolved unambiguously and
    ``ValueError`` for invalid arguments; the executor maps those to error codes.
    """

    if max_nodes < 1:
        raise ValueError("maxNodes must be positive")
    if max_depth < 1:
        raise ValueError("maxDepth must be positive")
    normalized_process = _normalize_process_name(process_name)
    if normalized_process in excluded_processes:
        raise LookupError("TARGET_PROCESS_EXCLUDED")

    candidates = backend.list_process_windows(process_name)
    if not candidates:
        raise LookupError("TARGET_APP_NOT_FOUND")
    if title_contains is not None:
        expected = title_contains.casefold()
        candidates = tuple(target for target in candidates if expected in target.title.casefold())
        if not candidates:
            raise LookupError("TARGET_WINDOW_NOT_FOUND")
    if len(candidates) != 1:
        raise LookupError("MULTIPLE_TARGET_WINDOWS")

    target = candidates[0]
    nodes, truncated, timed_out = _walk_target(
        target,
        max_nodes=max_nodes,
        max_depth=max_depth,
        timeout_seconds=timeout_ms / 1000.0,
        window_factory=window_factory,
    )
    title = sanitize_observation_text(target.title, maximum_length=MAXIMUM_TEXT_LENGTH)
    return ControlTreeCapture(
        process_name=target.process_name,
        process_id=target.process_id,
        window_handle=target.handle,
        window_title=title,
        nodes=nodes,
        truncated=truncated,
        timed_out=timed_out,
    )


def _walk_target(
    target: WindowTarget,
    *,
    max_nodes: int,
    max_depth: int,
    timeout_seconds: float,
    window_factory: Callable[[WindowTarget], Any],
) -> tuple[tuple[RawControlNode, ...], bool, bool]:
    collected: list[RawControlNode] = []
    truncated = False
    timed_out = False

    with _TimeoutGuard(timeout_seconds) as guard:
        try:
            root = guard.call(partial(window_factory, target))
            pending: deque[tuple[Any, int]] = deque([(root, 0)])
            while pending:
                if len(collected) >= max_nodes:
                    truncated = True
                    break
                wrapper, depth = pending.popleft()
                if depth >= max_depth:
                    # Depth limit reached: the subtree below this node is never walked, so
                    # the observation must be flagged rather than presented as complete.
                    truncated = True
                    continue

                node, children = guard.call(partial(_read_node, wrapper, depth))
                collected.append(node)
                for child in children:
                    pending.append((child, depth + 1))
        except TimeoutError:
            timed_out = True

    return tuple(collected), truncated, timed_out


def _read_node(wrapper: Any, depth: int) -> tuple[RawControlNode, list[Any]]:
    """Read one control and its direct children in a single guarded call."""

    info = wrapper.element_info
    node = RawControlNode(
        depth=depth,
        control_type=sanitize_observation_text(
            str(info.control_type or ""), maximum_length=MAXIMUM_TEXT_LENGTH
        ),
        automation_id=sanitize_observation_text(
            str(info.automation_id or ""), maximum_length=MAXIMUM_TEXT_LENGTH
        ),
        name=sanitize_observation_text(str(info.name or ""), maximum_length=MAXIMUM_TEXT_LENGTH),
        enabled=bool(wrapper.is_enabled()),
        visible=bool(wrapper.is_visible()),
    )
    return node, list(wrapper.children())

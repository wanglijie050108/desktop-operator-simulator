"""Tests for bounded control-tree collection.

The UIA wrapper is faked: these tests prove the Agent-side traversal contract (budget,
depth, timeout, exclusion, text hygiene) without a Windows desktop. Real pywinauto
behaviour is covered only by the Windows smoke run, which is NOT exercised here.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import pytest

from desktop_agent.observation import (
    DEFAULT_MAX_DEPTH,
    DEFAULT_MAX_NODES,
    DEFAULT_OPERATION_TIMEOUT_MS,
    collect_control_tree,
    normalize_excluded_processes,
    resolve_inspection_limits,
)
from desktop_agent.windows_executor import WindowTarget

TARGET = WindowTarget(handle=11, process_id=22, process_name="chrome", title="购物 - Chrome")


@dataclass
class FakeInfo:
    control_type: str = "Pane"
    automation_id: str = ""
    name: str = ""


@dataclass
class FakeWrapper:
    """Minimal stand-in for a pywinauto UIA wrapper."""

    info: FakeInfo = field(default_factory=FakeInfo)
    kids: list[FakeWrapper] = field(default_factory=list)
    enabled: bool = True
    visible: bool = True
    # When set, reading this node blocks for this many seconds (simulates a hung provider).
    hang_seconds: float = 0.0

    @property
    def element_info(self) -> FakeInfo:
        if self.hang_seconds:
            time.sleep(self.hang_seconds)
        return self.info

    def children(self) -> list[FakeWrapper]:
        return self.kids

    def is_enabled(self) -> bool:
        return self.enabled

    def is_visible(self) -> bool:
        return self.visible


class FakeBackend:
    def __init__(self, windows: dict[str, tuple[WindowTarget, ...]]) -> None:
        self._windows = windows

    def list_process_windows(self, process_name: str) -> tuple[WindowTarget, ...]:
        return self._windows.get(process_name.casefold(), ())


def _tree() -> FakeWrapper:
    return FakeWrapper(
        info=FakeInfo(control_type="Window", name="root"),
        kids=[
            FakeWrapper(
                info=FakeInfo(control_type="Button", automation_id="search", name="搜索"),
            ),
            FakeWrapper(
                info=FakeInfo(control_type="List", name="results"),
                kids=[
                    FakeWrapper(info=FakeInfo(control_type="ListItem", name=f"row-{index}"))
                    for index in range(3)
                ],
            ),
        ],
    )


def _collect(
    backend: FakeBackend,
    root: FakeWrapper | None = None,
    **overrides: Any,
) -> Any:
    options: dict[str, Any] = {
        "max_nodes": 100,
        "max_depth": 20,
        "timeout_ms": 2_000,
    }
    options.update(overrides)
    return collect_control_tree(
        backend,
        "chrome",
        None,
        excluded_processes=options.pop("excluded_processes", frozenset()),
        window_factory=lambda _target: root if root is not None else _tree(),
        **options,
    )


def test_collects_depth_first_nodes_with_metadata() -> None:
    capture = _collect(FakeBackend({"chrome": (TARGET,)}))

    assert capture.process_name == "chrome"
    assert capture.window_handle == 11
    assert capture.window_title == "购物 - Chrome"
    assert [node.depth for node in capture.nodes] == [0, 1, 1, 2, 2, 2]
    assert [node.control_type for node in capture.nodes[1:3]] == ["Button", "List"]
    assert capture.nodes[0].name == "root"
    assert capture.truncated is False
    assert capture.timed_out is False


def test_stops_at_the_node_budget_and_flags_truncation() -> None:
    capture = _collect(FakeBackend({"chrome": (TARGET,)}), max_nodes=3)

    assert len(capture.nodes) == 3
    assert capture.truncated is True


def test_exactly_filling_the_budget_is_not_truncated() -> None:
    capture = _collect(FakeBackend({"chrome": (TARGET,)}), max_nodes=6)

    assert len(capture.nodes) == 6
    assert capture.truncated is False


def test_depth_limit_flags_truncation_without_descending() -> None:
    capture = _collect(FakeBackend({"chrome": (TARGET,)}), max_depth=1)

    # Only the root (depth 0) is collected; its children are never walked.
    assert [node.depth for node in capture.nodes] == [0]
    assert capture.truncated is True


def test_slow_provider_times_out_and_keeps_partial_result() -> None:
    root = _tree()
    root.kids[1].hang_seconds = 2.0

    started = time.monotonic()
    capture = _collect(FakeBackend({"chrome": (TARGET,)}), root=root, timeout_ms=100)
    elapsed = time.monotonic() - started

    assert capture.timed_out is True
    # The healthy sibling collected before the hang is preserved.
    assert capture.nodes[0].control_type == "Window"
    assert capture.nodes[1].control_type == "Button"
    # The timeout is honoured rather than waiting for the provider to recover.
    assert elapsed < 1.5


def test_excluded_process_is_rejected_before_any_uia_call() -> None:
    calls: list[WindowTarget] = []

    def factory(target: WindowTarget) -> FakeWrapper:
        calls.append(target)
        return _tree()

    backend = FakeBackend({"chrome": (TARGET,)})
    with pytest.raises(LookupError) as error:
        collect_control_tree(
            backend,
            "chrome",
            None,
            max_nodes=10,
            max_depth=10,
            timeout_ms=1_000,
            excluded_processes=normalize_excluded_processes(["chrome.exe"]),
            window_factory=factory,
        )

    assert error.value.args[0] == "TARGET_PROCESS_EXCLUDED"
    # No accessibility provider was entered.
    assert calls == []


def test_missing_application_is_reported() -> None:
    with pytest.raises(LookupError) as error:
        _collect(FakeBackend({}))
    assert error.value.args[0] == "TARGET_APP_NOT_FOUND"


def test_title_filter_that_matches_nothing_is_reported() -> None:
    with pytest.raises(LookupError) as error:
        collect_control_tree(
            FakeBackend({"chrome": (TARGET,)}),
            "chrome",
            "not-present",
            max_nodes=10,
            max_depth=10,
            timeout_ms=1_000,
            window_factory=lambda _target: _tree(),
        )
    assert error.value.args[0] == "TARGET_WINDOW_NOT_FOUND"


def test_multiple_matching_windows_are_ambiguous() -> None:
    other = WindowTarget(handle=33, process_id=44, process_name="chrome", title="另一个")
    with pytest.raises(LookupError) as error:
        _collect(FakeBackend({"chrome": (TARGET, other)}))
    assert error.value.args[0] == "MULTIPLE_TARGET_WINDOWS"


def test_title_filter_narrows_to_one_window() -> None:
    other = WindowTarget(handle=33, process_id=44, process_name="chrome", title="另一个")
    capture = collect_control_tree(
        FakeBackend({"chrome": (TARGET, other)}),
        "chrome",
        "购物",
        max_nodes=10,
        max_depth=10,
        timeout_ms=1_000,
        window_factory=lambda _target: _tree(),
    )
    assert capture.window_handle == 11


def test_node_text_is_sanitized_before_it_leaves_the_agent() -> None:
    root = FakeWrapper(
        info=FakeInfo(control_type="Window", name="标题\ud83d"),
        kids=[FakeWrapper(info=FakeInfo(control_type="Text", name="a\ue000b\u202ec"))],
    )
    capture = _collect(FakeBackend({"chrome": (TARGET,)}), root=root)

    assert capture.nodes[0].name == "标题\ufffd"
    assert capture.nodes[1].name == "abc"
    # Every emitted string must survive strict UTF-8 encoding.
    for node in capture.nodes:
        assert node.name.encode("utf-8")


def test_node_text_is_length_capped() -> None:
    root = FakeWrapper(info=FakeInfo(control_type="Window", name="x" * 900))
    capture = _collect(FakeBackend({"chrome": (TARGET,)}), root=root)
    assert len(capture.nodes[0].name) == 200


def test_window_title_is_sanitized() -> None:
    target = WindowTarget(
        handle=1, process_id=2, process_name="chrome", title="购物\ud83d - 😀与\ue000"
    )
    capture = collect_control_tree(
        FakeBackend({"chrome": (target,)}),
        "chrome",
        None,
        max_nodes=10,
        max_depth=10,
        timeout_ms=1_000,
        window_factory=lambda _t: _tree(),
    )
    assert capture.window_title.encode("utf-8")
    assert "\ue000" not in capture.window_title


@pytest.mark.parametrize(
    ("values", "expected"),
    [
        (None, frozenset()),
        ((), frozenset()),
        (["chrome.exe"], frozenset({"chrome"})),
        (["CHROME.Exe", " chrome "], frozenset({"chrome"})),
        (["", "  "], frozenset()),
    ],
)
def test_excluded_process_normalization(values: list[str] | None, expected: frozenset[str]) -> None:
    assert normalize_excluded_processes(values) == expected


@pytest.mark.parametrize("value", ["../chrome.exe", "a b.exe", "C:\\Windows\\chrome.exe", "*"])
def test_excluded_process_rejects_paths_and_wildcards(value: str) -> None:
    with pytest.raises(ValueError):
        normalize_excluded_processes([value])


def test_limits_default_when_omitted() -> None:
    assert resolve_inspection_limits(max_nodes=None, max_depth=None, timeout_ms=None) == (
        DEFAULT_MAX_NODES,
        DEFAULT_MAX_DEPTH,
        DEFAULT_OPERATION_TIMEOUT_MS,
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"max_nodes": 0},
        {"max_nodes": 20_001},
        {"max_depth": 0},
        {"max_depth": 101},
        {"timeout_ms": 0},
        {"timeout_ms": 30_001},
    ],
)
def test_limits_reject_out_of_contract_values(overrides: dict[str, int]) -> None:
    arguments = {"max_nodes": None, "max_depth": None, "timeout_ms": None, **overrides}
    with pytest.raises(ValueError):
        resolve_inspection_limits(**arguments)


def test_collect_rejects_non_positive_budgets() -> None:
    backend = FakeBackend({"chrome": (TARGET,)})
    with pytest.raises(ValueError):
        _collect(backend, max_nodes=0)
    with pytest.raises(ValueError):
        _collect(backend, max_depth=0)

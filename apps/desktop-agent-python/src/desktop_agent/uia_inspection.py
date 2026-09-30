"""Privacy-safe UIA structure reports for Windows adapter investigation."""

from __future__ import annotations

import json
import os
import re
import secrets
import sys
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path, PureWindowsPath
from typing import Protocol

from .config import DEFAULT_ARTIFACT_DIRECTORY
from .wechat_ingress import IdentityHasher
from .windows_executor import DesktopActionFailure, WindowTarget, normalize_process_name

DEFAULT_WECHAT_PROCESS = "WeChat.exe"
ALLOWED_WECHAT_PROCESSES = frozenset({"wechat", "weixin"})
MAXIMUM_CONTROL_NODES = 2_000
MAXIMUM_STRUCTURE_FIELD_LENGTH = 200
_PROCESS_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
_SAFE_STRUCTURE_PATTERN = re.compile(r"^[A-Za-z0-9_.:#-]{1,200}$")


@dataclass(frozen=True, slots=True)
class RawUiaControlNode:
    depth: int
    control_type: str
    class_name: str
    automation_id: str
    name: str
    enabled: bool
    visible: bool


@dataclass(frozen=True, slots=True)
class SanitizedUiaControlNode:
    depth: int
    control_type: str
    class_name: str | None
    automation_id: str | None
    name_hash: str | None
    name_length: int
    enabled: bool
    visible: bool


@dataclass(frozen=True, slots=True)
class UiaInspectionReport:
    captured_at: str
    process_name: str
    process_id: int
    window_handle: int
    window_title_hash: str | None
    window_title_length: int
    node_count: int
    truncated: bool
    environment: dict[str, str | int]
    controls: tuple[SanitizedUiaControlNode, ...]

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=True, indent=2)


@dataclass(frozen=True, slots=True)
class UiaInspectionOptions:
    process_name: str
    title_contains: str | None
    artifact_directory: Path


class UiaInspectionBackend(Protocol):
    def find_window(self, process_name: str, title_contains: str | None) -> WindowTarget: ...

    def collect_control_tree(
        self,
        target: WindowTarget,
        maximum_nodes: int,
    ) -> tuple[list[RawUiaControlNode], bool]: ...

    def environment_metadata(self) -> dict[str, str | int]: ...


def build_inspection_report(
    target: WindowTarget,
    raw_nodes: list[RawUiaControlNode],
    *,
    truncated: bool,
    environment: dict[str, str | int],
    captured_at: datetime,
    hasher: IdentityHasher,
) -> UiaInspectionReport:
    if captured_at.utcoffset() != timedelta(0):
        raise ValueError("Inspection timestamp must use UTC")
    controls = tuple(_sanitize_node(node, hasher) for node in raw_nodes)
    return UiaInspectionReport(
        captured_at=captured_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        process_name=target.process_name,
        process_id=target.process_id,
        window_handle=target.handle,
        window_title_hash=(
            hasher.identifier("window-title", target.title) if target.title else None
        ),
        window_title_length=len(target.title),
        node_count=len(controls),
        truncated=truncated,
        environment=environment,
        controls=controls,
    )


def write_inspection_report(
    report: UiaInspectionReport,
    artifact_directory: Path,
) -> Path:
    report_directory = artifact_directory / "reports"
    report_directory.mkdir(parents=True, exist_ok=True)
    timestamp = report.captured_at.replace("-", "").replace(":", "").replace("T", "-")
    timestamp = timestamp.replace(".", "").replace("Z", "")
    destination = report_directory / f"wechat-uia-{timestamp}.json"
    destination.write_text(f"{report.to_json()}\n", encoding="utf-8")
    return destination


def _sanitize_node(
    node: RawUiaControlNode,
    hasher: IdentityHasher,
) -> SanitizedUiaControlNode:
    if node.depth < 0:
        raise ValueError("UIA node depth must not be negative")
    return SanitizedUiaControlNode(
        depth=node.depth,
        control_type=_sanitize_structure("control-type", node.control_type, hasher) or "Unknown",
        class_name=_sanitize_structure("class-name", node.class_name, hasher),
        automation_id=_sanitize_structure("automation-id", node.automation_id, hasher),
        name_hash=hasher.identifier("control-name", node.name) if node.name else None,
        name_length=len(node.name),
        enabled=node.enabled,
        visible=node.visible,
    )


def _sanitize_structure(
    kind: str,
    value: str,
    hasher: IdentityHasher,
) -> str | None:
    if not value:
        return None
    if (
        len(value) <= MAXIMUM_STRUCTURE_FIELD_LENGTH
        and _SAFE_STRUCTURE_PATTERN.fullmatch(value) is not None
    ):
        return value
    return hasher.identifier(kind, value)


def _validate_process_name(value: str) -> str:
    if PureWindowsPath(value).name != value or _PROCESS_NAME_PATTERN.fullmatch(value) is None:
        raise ValueError("WECHAT_PROCESS_NAME must be a pure process name")
    normalized = normalize_process_name(value)
    if normalized not in ALLOWED_WECHAT_PROCESSES:
        raise ValueError("WECHAT_PROCESS_NAME is not an allowed WeChat process")
    return normalized


def load_inspection_options(
    environment: Mapping[str, str] | None = None,
) -> UiaInspectionOptions:
    values = os.environ if environment is None else environment
    process_name = _validate_process_name(values.get("WECHAT_PROCESS_NAME", DEFAULT_WECHAT_PROCESS))
    title_contains = values.get("WECHAT_WINDOW_TITLE_CONTAINS")
    if title_contains is not None and not 1 <= len(title_contains) <= 200:
        raise ValueError("WECHAT_WINDOW_TITLE_CONTAINS must contain 1 to 200 characters")
    artifact_text = values.get("AGENT_ARTIFACT_DIR", str(DEFAULT_ARTIFACT_DIRECTORY))
    if not artifact_text.strip():
        raise ValueError("AGENT_ARTIFACT_DIR must not be empty")
    return UiaInspectionOptions(
        process_name=process_name,
        title_contains=title_contains,
        artifact_directory=Path(artifact_text),
    )


def main() -> int:
    if sys.platform != "win32":
        print('{"errorCode":"WINDOWS_REQUIRED"}')
        return 2

    try:
        options = load_inspection_options()
    except ValueError:
        print('{"errorCode":"INVALID_INSPECTION_CONFIGURATION"}')
        return 2

    from .windows_backend import PywinautoWindowsBackend

    backend = PywinautoWindowsBackend()
    try:
        target = backend.find_window(options.process_name, options.title_contains)
        raw_nodes, truncated = backend.collect_control_tree(target, MAXIMUM_CONTROL_NODES)
        report = build_inspection_report(
            target,
            raw_nodes,
            truncated=truncated,
            environment=backend.environment_metadata(),
            captured_at=datetime.now(UTC),
            hasher=IdentityHasher(secrets.token_bytes(32)),
        )
        destination = write_inspection_report(report, options.artifact_directory)
    except DesktopActionFailure as error:
        print(json.dumps({"errorCode": error.code}, separators=(",", ":")))
        return 1
    except Exception:
        print('{"errorCode":"UIA_INSPECTION_FAILED"}')
        return 1

    print(
        json.dumps(
            {
                "nodeCount": report.node_count,
                "truncated": report.truncated,
                "report": str(destination),
            },
            ensure_ascii=True,
            separators=(",", ":"),
        )
    )
    return 0

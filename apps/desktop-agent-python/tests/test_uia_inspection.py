from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

from desktop_agent.uia_inspection import (
    RawUiaControlNode,
    build_inspection_report,
    load_inspection_options,
    main,
    write_inspection_report,
)
from desktop_agent.wechat_ingress import IdentityHasher
from desktop_agent.windows_executor import WindowTarget

NOW = datetime(2026, 9, 28, 4, 0, tzinfo=UTC)
HMAC_KEY = b"inspection-test-hmac-key-32-bytes!"
TARGET = WindowTarget(
    handle=123,
    process_id=456,
    process_name="wechat",
    title="Sensitive Window Title",
)


def test_builds_report_without_exposing_names() -> None:
    report = build_inspection_report(
        TARGET,
        [
            RawUiaControlNode(
                depth=0,
                control_type="Window",
                class_name="WeChatMainWndForPC",
                automation_id="MainWindow",
                name="Sensitive Window Title",
                enabled=True,
                visible=True,
            ),
            RawUiaControlNode(
                depth=1,
                control_type="Document",
                class_name="unsafe class with spaces",
                automation_id="dynamic/id",
                name="Private message text",
                enabled=True,
                visible=True,
            ),
        ],
        truncated=False,
        environment={"os": "Windows-test"},
        captured_at=NOW,
        hasher=IdentityHasher(HMAC_KEY),
    )

    encoded = report.to_json()
    assert report.node_count == 2
    assert report.controls[0].class_name == "WeChatMainWndForPC"
    assert report.controls[0].automation_id == "MainWindow"
    assert report.controls[1].class_name is not None
    assert report.controls[1].class_name.startswith("hmac-sha256:")
    assert report.controls[1].automation_id is not None
    assert report.controls[1].automation_id.startswith("hmac-sha256:")
    assert "Sensitive Window Title" not in encoded
    assert "Private message text" not in encoded
    assert "unsafe class with spaces" not in encoded


def test_empty_structure_fields_remain_absent() -> None:
    report = build_inspection_report(
        TARGET,
        [
            RawUiaControlNode(
                depth=0,
                control_type="",
                class_name="",
                automation_id="",
                name="",
                enabled=False,
                visible=False,
            )
        ],
        truncated=True,
        environment={},
        captured_at=NOW,
        hasher=IdentityHasher(HMAC_KEY),
    )

    assert report.truncated
    assert report.controls[0].control_type == "Unknown"
    assert report.controls[0].class_name is None
    assert report.controls[0].automation_id is None
    assert report.controls[0].name_hash is None
    assert report.controls[0].name_length == 0


def test_rejects_invalid_depth_and_timestamp() -> None:
    with pytest.raises(ValueError, match="depth"):
        build_inspection_report(
            TARGET,
            [
                RawUiaControlNode(
                    depth=-1,
                    control_type="Window",
                    class_name="Class",
                    automation_id="Id",
                    name="",
                    enabled=True,
                    visible=True,
                )
            ],
            truncated=False,
            environment={},
            captured_at=NOW,
            hasher=IdentityHasher(HMAC_KEY),
        )

    with pytest.raises(ValueError, match="UTC"):
        build_inspection_report(
            TARGET,
            [],
            truncated=False,
            environment={},
            captured_at=datetime(2026, 9, 28, 4, 0),
            hasher=IdentityHasher(HMAC_KEY),
        )


def test_writes_sanitized_report(tmp_path: Path) -> None:
    report = build_inspection_report(
        TARGET,
        [],
        truncated=False,
        environment={},
        captured_at=NOW,
        hasher=IdentityHasher(HMAC_KEY),
    )

    destination = write_inspection_report(report, tmp_path)
    saved = json.loads(destination.read_text(encoding="utf-8"))

    assert destination.parent == tmp_path / "reports"
    assert saved["process_name"] == "wechat"
    assert saved["node_count"] == 0
    assert "Sensitive Window Title" not in destination.read_text(encoding="utf-8")


def test_loads_and_validates_inspection_options() -> None:
    options = load_inspection_options(
        {
            "WECHAT_PROCESS_NAME": "WeChat.exe",
            "WECHAT_WINDOW_TITLE_CONTAINS": "WeChat",
            "AGENT_ARTIFACT_DIR": "C:/automation-data/artifacts",
        }
    )

    assert options.process_name == "wechat"
    assert options.title_contains == "WeChat"
    assert str(options.artifact_directory) == "C:/automation-data/artifacts"

    for environment in (
        {"WECHAT_PROCESS_NAME": "../WeChat.exe"},
        {"WECHAT_PROCESS_NAME": "notepad.exe"},
        {"WECHAT_WINDOW_TITLE_CONTAINS": ""},
        {"WECHAT_WINDOW_TITLE_CONTAINS": "a" * 201},
        {"AGENT_ARTIFACT_DIR": " "},
    ):
        with pytest.raises(ValueError):
            load_inspection_options(environment)


def test_cli_fails_closed_outside_windows(capsys: pytest.CaptureFixture[str]) -> None:
    if sys.platform == "win32":
        pytest.skip("Non-Windows guard is only applicable off Windows")

    assert main() == 2
    assert json.loads(capsys.readouterr().out) == {"errorCode": "WINDOWS_REQUIRED"}

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from desktop_agent import windows_backend
from desktop_agent.uia_inspection import RawUiaControlNode
from desktop_agent.wechat_spike import (
    MAXIMUM_CONTROL_NODES,
    ConversationTitleLocator,
    WeChatSpikeOptions,
    count_visible_matches,
    load_wechat_spike_options,
    main,
    resolve_conversation_title,
    run_wechat_spike,
    write_report,
)
from desktop_agent.windows_executor import WindowTarget

CONVERSATION = "HOS-SPIKE-TARGET"
WINDOW = WindowTarget(123, 456, "wechat", "微信")


def _node(
    name: str,
    *,
    automation_id: str = "",
    class_name: str = "",
    visible: bool = True,
) -> RawUiaControlNode:
    return RawUiaControlNode(
        depth=1,
        control_type="Text",
        class_name=class_name,
        automation_id=automation_id,
        name=name,
        enabled=True,
        visible=visible,
    )


class FakeWeChatBackend:
    def __init__(
        self,
        *,
        title: str = CONVERSATION,
        echo: bool = True,
        foreground: bool = True,
        title_sequence: list[str] | None = None,
        duplicate_title: bool = False,
        metadata_error: bool = False,
        release_error: bool = False,
        send_error: Exception | None = None,
        echo_after_collects: int = 0,
    ) -> None:
        self.title = title
        self.echo = echo
        self.foreground = foreground
        self.title_sequence = title_sequence
        self.duplicate_title = duplicate_title
        self.metadata_error = metadata_error
        self.release_error = release_error
        self.send_error = send_error
        self.echo_after_collects = echo_after_collects
        self.pending_echo: str | None = None
        self.echo_deadline = 0
        self.sent: list[str] = []
        self.messages: list[str] = []
        self.activations = 0
        self.released = 0
        self.collect_calls = 0

    def find_window(self, process_name: str, title_contains: str | None) -> WindowTarget:
        assert process_name == "wechat"
        assert title_contains is None
        return WINDOW

    def activate(self, target: WindowTarget) -> None:
        assert target == WINDOW
        self.activations += 1

    def is_foreground(self, target: WindowTarget) -> bool:
        assert target == WINDOW
        return self.foreground

    def collect_control_tree(
        self,
        target: WindowTarget,
        maximum_nodes: int,
    ) -> tuple[list[RawUiaControlNode], bool]:
        assert target == WINDOW
        assert maximum_nodes == MAXIMUM_CONTROL_NODES
        if self.pending_echo is not None and self.collect_calls >= self.echo_deadline:
            self.messages.append(self.pending_echo)
            self.pending_echo = None
        title = self.title
        if self.title_sequence is not None:
            index = min(self.collect_calls, len(self.title_sequence) - 1)
            title = self.title_sequence[index]
        self.collect_calls += 1
        nodes = [_node(title, automation_id="chat_title", class_name="ChatTitle")]
        if self.duplicate_title:
            nodes.append(_node(title, automation_id="chat_title", class_name="ChatTitle"))
        nodes.extend(_node(message) for message in self.messages)
        return nodes, False

    def send_chat_text(self, target: WindowTarget, text: str) -> None:
        assert target == WINDOW
        if self.send_error is not None:
            raise self.send_error
        self.sent.append(text)
        if self.echo:
            if self.echo_after_collects > 0:
                self.pending_echo = text
                self.echo_deadline = self.collect_calls + self.echo_after_collects
            else:
                self.messages.append(text)

    def release_inputs(self) -> None:
        self.released += 1
        if self.release_error:
            raise RuntimeError("release failed")

    def environment_metadata(self) -> dict[str, str | int]:
        if self.metadata_error:
            raise RuntimeError("metadata unavailable")
        return {"os": "Windows-11-test", "python": "3.11.test"}


def _options(
    tmp_path: Path,
    *,
    confirmed: bool = True,
    iterations: int = 3,
    automation_id: str | None = "chat_title",
    class_name: str | None = None,
    expected: str = CONVERSATION,
) -> WeChatSpikeOptions:
    return WeChatSpikeOptions(
        process_name="wechat",
        expected_conversation=expected,
        title_locator=ConversationTitleLocator(
            automation_id=automation_id,
            class_name=class_name,
        ),
        confirmed=confirmed,
        iterations=iterations,
        artifact_directory=tmp_path,
    )


@pytest.mark.asyncio
async def test_sends_and_reads_back_every_iteration(tmp_path: Path) -> None:
    backend = FakeWeChatBackend()

    report = await run_wechat_spike(
        backend,
        _options(tmp_path, iterations=3),
        readback_timeout=0.01,
        readback_interval=0.001,
    )

    assert report.passed is True
    assert report.setup_error is None
    assert report.success_count == 3
    assert report.success_rate == 1.0
    assert len(backend.sent) == 3
    assert backend.released == 3
    assert all(run.observed_matches == 1 for run in report.runs)


@pytest.mark.asyncio
async def test_refuses_to_run_without_explicit_confirmation(tmp_path: Path) -> None:
    backend = FakeWeChatBackend()

    report = await run_wechat_spike(backend, _options(tmp_path, confirmed=False))

    assert report.setup_error == "SPIKE_CONFIRMATION_REQUIRED"
    assert report.passed is False
    assert backend.sent == []
    assert backend.collect_calls == 0
    assert backend.released == 0


@pytest.mark.asyncio
async def test_fails_closed_when_conversation_title_does_not_match(tmp_path: Path) -> None:
    backend = FakeWeChatBackend(title="SOMEONE-ELSE")

    report = await run_wechat_spike(backend, _options(tmp_path))

    assert report.setup_error == "CONVERSATION_MISMATCH"
    assert report.passed is False
    assert backend.sent == []
    assert backend.activations == 0


@pytest.mark.asyncio
async def test_fails_closed_when_title_locator_is_ambiguous(tmp_path: Path) -> None:
    backend = FakeWeChatBackend(duplicate_title=True)

    report = await run_wechat_spike(backend, _options(tmp_path))

    assert report.setup_error == "CONVERSATION_TITLE_NOT_FOUND"
    assert backend.sent == []


@pytest.mark.asyncio
async def test_blocks_send_when_window_is_not_foreground(tmp_path: Path) -> None:
    backend = FakeWeChatBackend(foreground=False)

    report = await run_wechat_spike(backend, _options(tmp_path, iterations=2))

    assert report.passed is False
    assert report.error_counts == {"TARGET_WINDOW_NOT_FOREGROUND": 2}
    assert backend.sent == []
    assert backend.released == 2


@pytest.mark.asyncio
async def test_aborts_when_conversation_changed_after_activation(tmp_path: Path) -> None:
    backend = FakeWeChatBackend(title_sequence=[CONVERSATION, "SOMEONE-ELSE"])

    report = await run_wechat_spike(backend, _options(tmp_path, iterations=1))

    assert report.passed is False
    assert report.error_counts == {"CONVERSATION_CHANGED": 1}
    assert backend.sent == []


@pytest.mark.asyncio
async def test_records_missing_read_back(tmp_path: Path) -> None:
    backend = FakeWeChatBackend(echo=False)

    report = await run_wechat_spike(
        backend,
        _options(tmp_path, iterations=2),
        readback_timeout=0,
    )

    assert report.passed is False
    assert report.error_counts == {"MESSAGE_NOT_OBSERVED": 2}
    assert len(backend.sent) == 2


@pytest.mark.asyncio
async def test_records_input_release_failure(tmp_path: Path) -> None:
    backend = FakeWeChatBackend(release_error=True)

    report = await run_wechat_spike(
        backend,
        _options(tmp_path, iterations=1),
        readback_timeout=0.01,
        readback_interval=0.001,
    )

    assert report.error_counts == {"INPUT_RELEASE_FAILED": 1}


@pytest.mark.asyncio
async def test_records_unexpected_send_error(tmp_path: Path) -> None:
    backend = FakeWeChatBackend(send_error=RuntimeError("boom"))

    report = await run_wechat_spike(backend, _options(tmp_path, iterations=1))

    assert report.error_counts == {"SPIKE_UNEXPECTED_ERROR": 1}


@pytest.mark.asyncio
async def test_reports_setup_failure_when_metadata_is_unavailable(tmp_path: Path) -> None:
    backend = FakeWeChatBackend(metadata_error=True)

    report = await run_wechat_spike(backend, _options(tmp_path))

    assert report.setup_error == "SPIKE_SETUP_FAILED"
    assert backend.sent == []


@pytest.mark.asyncio
async def test_report_never_contains_plaintext_conversation_or_message(tmp_path: Path) -> None:
    backend = FakeWeChatBackend()

    report = await run_wechat_spike(
        backend,
        _options(tmp_path, iterations=1),
        readback_timeout=0.01,
        readback_interval=0.001,
    )

    payload = report.to_json()
    assert CONVERSATION not in payload
    assert all(text not in payload for text in backend.sent)
    assert report.expected_conversation_length == len(CONVERSATION)
    assert len(report.expected_conversation_hash) == 64


@pytest.mark.asyncio
async def test_write_report_creates_artifact(tmp_path: Path) -> None:
    backend = FakeWeChatBackend()

    report = await run_wechat_spike(
        backend,
        _options(tmp_path, iterations=1),
        readback_timeout=0.01,
        readback_interval=0.001,
    )
    destination = write_report(report, tmp_path)

    assert destination.name.startswith("wechat-spike-")
    assert json.loads(destination.read_text(encoding="utf-8"))["passed"] is True


def test_resolve_title_requires_unique_automation_id_match() -> None:
    locator = ConversationTitleLocator(automation_id="chat_title")
    assert resolve_conversation_title(
        [_node(CONVERSATION, automation_id="chat_title")], locator
    ) == (CONVERSATION)
    assert (
        resolve_conversation_title(
            [
                _node(CONVERSATION, automation_id="chat_title"),
                _node(CONVERSATION, automation_id="chat_title"),
            ],
            locator,
        )
        is None
    )
    assert resolve_conversation_title([_node(CONVERSATION, automation_id="other")], locator) is None
    assert (
        resolve_conversation_title(
            [_node(CONVERSATION, automation_id="chat_title", visible=False)],
            locator,
        )
        is None
    )


def test_resolve_title_supports_class_name_ordinal() -> None:
    nodes = [
        _node("侧边栏", class_name="ChatTitle"),
        _node(CONVERSATION, class_name="ChatTitle"),
    ]

    assert (
        resolve_conversation_title(
            nodes,
            ConversationTitleLocator(class_name="ChatTitle", ordinal=2),
        )
        == CONVERSATION
    )
    assert (
        resolve_conversation_title(
            nodes,
            ConversationTitleLocator(class_name="ChatTitle", ordinal=3),
        )
        is None
    )


def test_count_visible_matches_normalizes_text_and_ignores_hidden_nodes() -> None:
    nodes = [
        _node("【HOS-SPIKE】01-abcdef"),
        _node("  【HOS-SPIKE】01-abcdef  "),
        _node("【HOS-SPIKE】01-abcdef", visible=False),
    ]

    assert count_visible_matches(nodes, "【HOS-SPIKE】01-abcdef") == 2


def test_title_locator_rejects_invalid_configuration() -> None:
    with pytest.raises(ValueError):
        ConversationTitleLocator(automation_id="a", class_name="b")
    with pytest.raises(ValueError):
        ConversationTitleLocator()
    with pytest.raises(ValueError):
        ConversationTitleLocator(automation_id="a", ordinal=0)


def test_load_options_accepts_automation_id_configuration() -> None:
    options = load_wechat_spike_options(
        {
            "WECHAT_EXPECTED_CONVERSATION": CONVERSATION,
            "WECHAT_SPIKE_TITLE_AUTOMATION_ID": "chat_title",
            "WECHAT_SPIKE_CONFIRM": "1",
            "WECHAT_SPIKE_ITERATIONS": "5",
            "AGENT_ARTIFACT_DIR": "artifacts",
        }
    )

    assert options.process_name == "weixin"
    assert options.confirmed is True
    assert options.iterations == 5
    assert options.title_locator.automation_id == "chat_title"
    assert options.artifact_directory == Path("artifacts")


def test_load_options_accepts_class_name_configuration() -> None:
    options = load_wechat_spike_options(
        {
            "WECHAT_EXPECTED_CONVERSATION": CONVERSATION,
            "WECHAT_SPIKE_TITLE_CLASS_NAME": "ChatTitle",
            "WECHAT_SPIKE_TITLE_ORDINAL": "2",
        }
    )

    assert options.title_locator.class_name == "ChatTitle"
    assert options.title_locator.ordinal == 2
    assert options.confirmed is False
    assert options.iterations == 20


@pytest.mark.parametrize(
    "environment",
    [
        {},
        {"WECHAT_EXPECTED_CONVERSATION": CONVERSATION},
        {
            "WECHAT_EXPECTED_CONVERSATION": CONVERSATION,
            "WECHAT_SPIKE_TITLE_AUTOMATION_ID": "chat_title",
            "WECHAT_SPIKE_TITLE_CLASS_NAME": "ChatTitle",
        },
        {
            "WECHAT_EXPECTED_CONVERSATION": CONVERSATION,
            "WECHAT_SPIKE_TITLE_AUTOMATION_ID": "chat_title",
            "WECHAT_SPIKE_ITERATIONS": "0",
        },
        {
            "WECHAT_EXPECTED_CONVERSATION": CONVERSATION,
            "WECHAT_SPIKE_TITLE_AUTOMATION_ID": "chat_title",
            "WECHAT_SPIKE_ITERATIONS": "many",
        },
        {
            "WECHAT_EXPECTED_CONVERSATION": CONVERSATION,
            "WECHAT_SPIKE_TITLE_AUTOMATION_ID": "chat_title",
            "WECHAT_SPIKE_TITLE_ORDINAL": "zero",
        },
        {
            "WECHAT_EXPECTED_CONVERSATION": CONVERSATION,
            "WECHAT_SPIKE_TITLE_AUTOMATION_ID": "chat_title",
            "WECHAT_SPIKE_TITLE_ORDINAL": "-1",
        },
        {
            "WECHAT_EXPECTED_CONVERSATION": CONVERSATION,
            "WECHAT_SPIKE_TITLE_AUTOMATION_ID": "chat_title",
            "WECHAT_PROCESS_NAME": "evil.exe",
        },
        {
            "WECHAT_EXPECTED_CONVERSATION": CONVERSATION,
            "WECHAT_SPIKE_TITLE_AUTOMATION_ID": "chat_title",
            "WECHAT_PROCESS_NAME": "C:\\wechat.exe",
        },
        {
            "WECHAT_EXPECTED_CONVERSATION": CONVERSATION,
            "WECHAT_SPIKE_TITLE_AUTOMATION_ID": "chat_title",
            "AGENT_ARTIFACT_DIR": " ",
        },
    ],
)
def test_load_options_rejects_invalid_configuration(environment: dict[str, str]) -> None:
    with pytest.raises(ValueError):
        load_wechat_spike_options(environment)


@pytest.mark.asyncio
async def test_rejects_invalid_run_arguments(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        await run_wechat_spike(FakeWeChatBackend(), _options(tmp_path, iterations=0))
    with pytest.raises(ValueError):
        await run_wechat_spike(
            FakeWeChatBackend(),
            _options(tmp_path, iterations=1),
            readback_timeout=-1,
        )
    with pytest.raises(ValueError):
        await run_wechat_spike(
            FakeWeChatBackend(),
            _options(tmp_path, iterations=1),
            readback_interval=0,
        )


@pytest.mark.asyncio
async def test_waits_for_a_delayed_echo(tmp_path: Path) -> None:
    backend = FakeWeChatBackend(echo_after_collects=1)

    report = await run_wechat_spike(
        backend,
        _options(tmp_path, iterations=1),
        readback_timeout=1,
        readback_interval=0.001,
    )

    assert report.passed is True
    assert report.runs[0].observed_matches == 1


@pytest.mark.asyncio
async def test_title_disappearing_after_activation_is_not_mislabeled(tmp_path: Path) -> None:
    backend = FakeWeChatBackend(title_sequence=[CONVERSATION, ""])

    report = await run_wechat_spike(backend, _options(tmp_path, iterations=1))

    assert report.error_counts == {"CONVERSATION_TITLE_NOT_FOUND": 1}
    assert backend.sent == []


def test_main_requires_windows(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(sys, "platform", "darwin")

    assert main() == 2
    assert json.loads(capsys.readouterr().out) == {"errorCode": "WINDOWS_REQUIRED"}


def test_main_rejects_invalid_configuration(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.delenv("WECHAT_EXPECTED_CONVERSATION", raising=False)
    monkeypatch.delenv("WECHAT_SPIKE_TITLE_AUTOMATION_ID", raising=False)
    monkeypatch.delenv("WECHAT_SPIKE_TITLE_CLASS_NAME", raising=False)

    assert main() == 2
    assert json.loads(capsys.readouterr().out) == {"errorCode": "INVALID_SPIKE_CONFIGURATION"}


def test_main_runs_spike_and_writes_report(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    backend = FakeWeChatBackend()
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(windows_backend, "PywinautoWindowsBackend", lambda: backend)
    monkeypatch.setenv("WECHAT_EXPECTED_CONVERSATION", CONVERSATION)
    monkeypatch.setenv("WECHAT_PROCESS_NAME", "WeChat.exe")
    monkeypatch.setenv("WECHAT_SPIKE_TITLE_AUTOMATION_ID", "chat_title")
    monkeypatch.setenv("WECHAT_SPIKE_CONFIRM", "1")
    monkeypatch.setenv("WECHAT_SPIKE_ITERATIONS", "1")
    monkeypatch.setenv("AGENT_ARTIFACT_DIR", str(tmp_path))

    assert main() == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["passed"] is True
    assert payload["successCount"] == 1
    assert Path(payload["report"]).exists()


def test_default_spike_process_targets_wechat_4x() -> None:
    options = load_wechat_spike_options(
        {
            "WECHAT_EXPECTED_CONVERSATION": CONVERSATION,
            "WECHAT_SPIKE_TITLE_AUTOMATION_ID": "chat_title",
        }
    )

    assert options.process_name == "weixin"

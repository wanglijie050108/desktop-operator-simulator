"""Tests for the UIA-based WeChat message source using mock control trees."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from desktop_agent.uia_inspection import RawUiaControlNode
from desktop_agent.wechat_source import (
    ConversationSnapshot,
    WeChatUiAMessageSource,
    extract_conversation,
)
from desktop_agent.windows_executor import WindowTarget


def node(
    *,
    depth: int = 0,
    control_type: str = "Text",
    name: str = "",
    visible: bool = True,
    automation_id: str = "",
) -> RawUiaControlNode:
    return RawUiaControlNode(
        depth=depth,
        control_type=control_type,
        class_name="Mock",
        automation_id=automation_id,
        name=name,
        enabled=True,
        visible=visible,
    )


class FakeWeChatBackend:
    def __init__(self, nodes: list[RawUiaControlNode], title: str = "WeChat") -> None:
        self._nodes = nodes
        self._title = title
        self.poll_calls = 0

    def find_window(self, process_name: str, title_contains: str | None) -> WindowTarget:
        return WindowTarget(
            handle=1,
            process_id=2,
            process_name=process_name.casefold(),
            title=self._title,
        )

    def collect_control_tree(
        self, target: WindowTarget, maximum_nodes: int
    ) -> tuple[list[RawUiaControlNode], bool]:
        return self._nodes[:maximum_nodes], False


def test_extracts_visible_text_nodes_as_peer_messages() -> None:
    nodes = [
        node(name="Alice", control_type="Text"),
        node(name="", control_type="Text"),
        node(name="Are you there?", control_type="ListItem"),
        node(name="Yes, how can I help?", control_type="ListItem", visible=False),
        node(name="Please confirm the order.", control_type="Text"),
    ]

    snapshot = extract_conversation(nodes, window_title="WeChat")

    assert isinstance(snapshot, ConversationSnapshot)
    # Empty and invisible nodes are skipped.
    assert [m.content for m in snapshot.messages] == [
        "Alice",
        "Are you there?",
        "Please confirm the order.",
    ]
    # Without calibrated title automation ids the conversation label falls back to the title.
    assert snapshot.conversation_label == "WeChat"
    for message in snapshot.messages:
        assert message.sender_label == "WeChat"
        assert message.visible_index >= 0


def test_extraction_uses_clock_for_observation_time() -> None:
    clock = datetime(2026, 10, 1, 12, 0, 0, tzinfo=UTC)
    nodes = [node(name="hi", control_type="Text")]

    snapshot = extract_conversation(nodes, window_title="WeChat", clock=clock)

    assert snapshot.messages[0].observed_at == clock


def test_extraction_caps_visible_message_count() -> None:
    nodes = [node(name=f"m{i}", control_type="Text") for i in range(80)]

    snapshot = extract_conversation(nodes, window_title="WeChat")

    assert len(snapshot.messages) == 50


@pytest.mark.asyncio
async def test_source_poll_returns_messages_from_backend() -> None:
    backend = FakeWeChatBackend(
        [
            node(name="Alice", control_type="Text"),
            node(name="Send me the summary.", control_type="ListItem"),
        ]
    )
    source = WeChatUiAMessageSource(backend, process_name="WeChat.exe")

    messages = await source.poll()

    assert [m.content for m in messages] == ["Alice", "Send me the summary."]
    # find_window received the normalized process name.
    assert isinstance(messages[0], object)


def test_extraction_empty_tree_yields_no_messages() -> None:
    snapshot = extract_conversation([], window_title="WeChat")
    assert snapshot.messages == ()
    assert snapshot.conversation_label == "WeChat"


def test_extraction_blank_title_falls_back_to_synthetic_label() -> None:
    snapshot = extract_conversation([node(name="hi")], window_title="   ")
    assert snapshot.conversation_label == "wechat-conversation"

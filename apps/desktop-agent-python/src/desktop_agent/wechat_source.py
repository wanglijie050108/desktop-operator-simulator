"""UIA-based WeChat message source behind a cross-platform testable boundary.

This is the real implementation of :class:`WeChatMessageSource` that the migration planning
left as a Protocol. It reads the active conversation from the WeChat desktop window using
semantic UIA locators and returns the visible messages as :class:`VisibleChatMessage` records
that already carry HMAC fingerprints and never store plaintext identifiers.

WARNING: The locator heuristics below describe the common WeChat 4.x layout and have NOT been
validated against the target build. Run the read-only UIA inspection tool on the target Windows
host and re-calibrate the locator constants before enabling live ingestion. Every code path here
is exercised only with mock control trees in unit tests; no live desktop access is required.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from .uia_inspection import RawUiaControlNode
from .wechat_ingress import VisibleChatMessage, WeChatMessageSource
from .windows_executor import WindowTarget, normalize_process_name

DEFAULT_WECHAT_PROCESS = "WeChat.exe"
MAXIMUM_CONTROL_NODES = 4_000
MAXIMUM_VISIBLE_MESSAGES = 50

# Locator heuristics for the active conversation. These are the parts that must be re-validated
# against the real WeChat build via read-only inspection before live use.
CHAT_TITLE_AUTOMATION_IDS: frozenset[str] = frozenset()
MESSAGE_ITEM_CONTROL_TYPES: frozenset[str] = frozenset({"ListItem", "Text"})


class WeChatUiABackend(Protocol):
    """Minimal backend surface needed to ingest the active WeChat conversation."""

    def find_window(self, process_name: str, title_contains: str | None) -> WindowTarget: ...

    def collect_control_tree(
        self, target: WindowTarget, maximum_nodes: int
    ) -> tuple[list[RawUiaControlNode], bool]: ...


@dataclass(frozen=True, slots=True)
class ConversationSnapshot:
    conversation_label: str
    messages: tuple[VisibleChatMessage, ...]


def extract_conversation(
    nodes: Sequence[RawUiaControlNode],
    *,
    window_title: str,
    clock: datetime | None = None,
) -> ConversationSnapshot:
    """Heuristic extraction of the active conversation from a UIA control tree.

    The conversation label falls back to the window title when no title control matches the
    configured automation ids. Visible text nodes are treated as messages from the conversation
    peer until the layout is re-calibrated against the real build.
    """
    if clock is None:
        clock = datetime.now(UTC)
    conversation_label = _resolve_conversation_label(nodes, window_title)
    messages: list[VisibleChatMessage] = []
    index = 0
    for node in nodes:
        if not node.visible:
            continue
        if node.control_type not in MESSAGE_ITEM_CONTROL_TYPES:
            continue
        content = node.name.strip()
        if not content:
            continue
        messages.append(
            VisibleChatMessage(
                conversation_label=conversation_label,
                sender_label=conversation_label,
                content=content,
                observed_at=clock,
                visible_index=index,
            )
        )
        index += 1
        if index >= MAXIMUM_VISIBLE_MESSAGES:
            break
    return ConversationSnapshot(conversation_label, tuple(messages))


def _resolve_conversation_label(nodes: Sequence[RawUiaControlNode], window_title: str) -> str:
    for node in nodes:
        if node.automation_id in CHAT_TITLE_AUTOMATION_IDS and node.name.strip():
            return node.name.strip()
    return window_title.strip() or "wechat-conversation"


class WeChatUiAMessageSource(WeChatMessageSource):
    """Reads the active WeChat conversation from UIA via a :class:`WeChatUiABackend`."""

    def __init__(
        self,
        backend: WeChatUiABackend,
        *,
        process_name: str = DEFAULT_WECHAT_PROCESS,
        maximum_nodes: int = MAXIMUM_CONTROL_NODES,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._backend = backend
        self._process_name = normalize_process_name(process_name)
        self._maximum_nodes = maximum_nodes
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))

    async def poll(self) -> Sequence[VisibleChatMessage]:
        return await asyncio.to_thread(self._poll_sync)

    def _poll_sync(self) -> list[VisibleChatMessage]:
        target = self._backend.find_window(self._process_name, None)
        raw_nodes, _ = self._backend.collect_control_tree(target, self._maximum_nodes)
        snapshot = extract_conversation(raw_nodes, window_title=target.title, clock=self._clock())
        return list(snapshot.messages)

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import pytest

from desktop_agent.protocol import ChatMessageReceived
from desktop_agent.wechat_ingress import (
    IdentityHasher,
    MessageDeduplicator,
    VisibleChatMessage,
    WeChatMessageEncoder,
    WeChatMessagePump,
    WeChatMessageSource,
)

NOW = datetime(2026, 9, 28, 4, 0, 30, tzinfo=UTC)
HMAC_KEY = b"unit-test-only-identity-key-32-bytes"


def visible_message(
    *,
    content: str = "#assistant test request",
    visible_index: int = 3,
    source_message_id: str | None = None,
) -> VisibleChatMessage:
    return VisibleChatMessage(
        conversation_label="Test Conversation",
        sender_label="Test Sender",
        content=content,
        observed_at=NOW,
        visible_index=visible_index,
        source_message_id=source_message_id,
    )


class RepeatingSource(WeChatMessageSource):
    def __init__(self, messages: Sequence[VisibleChatMessage]) -> None:
        self.messages = messages
        self.poll_count = 0

    async def poll(self) -> Sequence[VisibleChatMessage]:
        self.poll_count += 1
        return self.messages


class FailingOnceSource(RepeatingSource):
    async def poll(self) -> Sequence[VisibleChatMessage]:
        self.poll_count += 1
        if self.poll_count == 1:
            raise RuntimeError("private source details")
        return self.messages


class RejectingFirstEncoder(WeChatMessageEncoder):
    def encode(self, message: VisibleChatMessage) -> ChatMessageReceived:
        if message.content == "invalid":
            raise ValueError("private invalid content")
        return super().encode(message)


def test_hashes_identifiers_without_exposing_labels() -> None:
    hasher = IdentityHasher(HMAC_KEY)

    conversation = hasher.identifier("conversation", " Test Conversation ")
    sender = hasher.identifier("sender", "Test Sender")

    assert conversation.startswith("hmac-sha256:")
    assert sender.startswith("hmac-sha256:")
    assert conversation != sender
    assert "Conversation" not in conversation
    assert "Sender" not in sender


def test_fingerprint_normalizes_text_and_uses_minute_bucket() -> None:
    hasher = IdentityHasher(HMAC_KEY)
    first = visible_message(content="Ａ  test\n request")
    equivalent = VisibleChatMessage(
        conversation_label="Test Conversation",
        sender_label="Test Sender",
        content="A test request",
        observed_at=NOW + timedelta(seconds=20),
        visible_index=3,
    )
    next_position = visible_message(content="A test request", visible_index=4)

    assert hasher.message_fingerprint(first) == hasher.message_fingerprint(equivalent)
    assert hasher.message_fingerprint(first) != hasher.message_fingerprint(next_position)


def test_source_message_id_takes_precedence_in_fingerprint() -> None:
    hasher = IdentityHasher(HMAC_KEY)
    first = visible_message(content="first", source_message_id="stable-id")
    changed = visible_message(content="changed", source_message_id="stable-id")
    other_conversation = VisibleChatMessage(
        conversation_label="Other Conversation",
        sender_label="Test Sender",
        content="changed",
        observed_at=NOW,
        visible_index=3,
        source_message_id="stable-id",
    )

    assert hasher.message_fingerprint(first) == hasher.message_fingerprint(changed)
    assert hasher.message_fingerprint(first) != hasher.message_fingerprint(other_conversation)


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"conversation_label": " "}, "Conversation"),
        ({"conversation_label": "a" * 501}, "Conversation"),
        ({"sender_label": ""}, "Sender"),
        ({"sender_label": "a" * 501}, "Sender"),
        ({"content": "\n"}, "content"),
        ({"content": "a" * 4_001}, "content"),
        ({"observed_at": datetime(2026, 9, 28, 4, 0)}, "UTC"),
        ({"observed_at": NOW.astimezone(timezone(timedelta(hours=8)))}, "UTC"),
        ({"visible_index": -1}, "index"),
        ({"source_message_id": " "}, "Source message"),
        ({"source_message_id": "a" * 501}, "Source message"),
    ],
)
def test_visible_message_rejects_invalid_values(
    kwargs: dict[str, Any],
    message: str,
) -> None:
    values: dict[str, Any] = {
        "conversation_label": "conversation",
        "sender_label": "sender",
        "content": "content",
        "observed_at": NOW,
        "visible_index": 0,
    }
    values.update(kwargs)
    with pytest.raises(ValueError, match=message):
        VisibleChatMessage(**values)


def test_encoder_builds_strict_private_protocol_event() -> None:
    encoder = WeChatMessageEncoder(IdentityHasher(HMAC_KEY), clock=lambda: NOW)

    event = encoder.encode(visible_message(content="  #assistant question  "))

    assert isinstance(event, ChatMessageReceived)
    assert event.timestamp == NOW
    assert event.payload.received_at == NOW
    assert event.payload.content == "#assistant question"
    assert event.payload.conversation_id.startswith("hmac-sha256:")
    assert event.payload.sender_id.startswith("hmac-sha256:")
    assert event.payload.external_message_id.startswith("wechat:")


def test_deduplicator_expires_and_evicts() -> None:
    deduplicator = MessageDeduplicator(timedelta(minutes=1), capacity=1)

    assert not deduplicator.contains("first", NOW)
    deduplicator.register("first", NOW)
    assert deduplicator.contains("first", NOW)
    deduplicator.register("second", NOW + timedelta(seconds=1))
    assert not deduplicator.contains("first", NOW + timedelta(seconds=2))
    deduplicator.register("first", NOW + timedelta(minutes=2))
    assert deduplicator.contains("first", NOW + timedelta(minutes=2))


@pytest.mark.asyncio
async def test_pump_publishes_once_and_deduplicates_after_success() -> None:
    message = visible_message()
    source = RepeatingSource([message, visible_message(content="second")])
    stop = asyncio.Event()
    published: list[ChatMessageReceived] = []
    pump = WeChatMessagePump(
        source,
        WeChatMessageEncoder(IdentityHasher(HMAC_KEY), clock=lambda: NOW),
        poll_interval=0.01,
        clock=lambda: NOW,
    )

    async def publish(event: ChatMessageReceived) -> None:
        published.append(event)
        stop.set()

    await asyncio.wait_for(pump.run(publish, stop), timeout=1)

    assert len(published) == 1
    assert source.poll_count == 1


@pytest.mark.asyncio
async def test_pump_retries_message_when_publish_fails() -> None:
    source = RepeatingSource([visible_message()])
    stop = asyncio.Event()
    attempts = 0
    logs: list[str] = []
    pump = WeChatMessagePump(
        source,
        WeChatMessageEncoder(IdentityHasher(HMAC_KEY), clock=lambda: NOW),
        poll_interval=0.01,
        clock=lambda: NOW,
        log=logs.append,
    )

    async def publish(_: ChatMessageReceived) -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ConnectionError("private message content")
        stop.set()

    await asyncio.wait_for(pump.run(publish, stop), timeout=1)

    assert attempts == 2
    assert logs == ["WeChat message publishing failed: ConnectionError"]
    assert "private message content" not in logs[0]


@pytest.mark.asyncio
async def test_pump_skips_invalid_message_without_logging_content() -> None:
    source = RepeatingSource(
        [
            visible_message(content="invalid"),
            visible_message(content="valid", visible_index=4),
        ]
    )
    stop = asyncio.Event()
    published: list[ChatMessageReceived] = []
    logs: list[str] = []
    pump = WeChatMessagePump(
        source,
        RejectingFirstEncoder(IdentityHasher(HMAC_KEY), clock=lambda: NOW),
        poll_interval=0.01,
        clock=lambda: NOW,
        log=logs.append,
    )

    async def publish(event: ChatMessageReceived) -> None:
        published.append(event)
        stop.set()

    await asyncio.wait_for(pump.run(publish, stop), timeout=1)

    assert [event.payload.content for event in published] == ["valid"]
    assert logs == ["WeChat message encoding failed: ValueError"]
    assert "private invalid content" not in logs[0]


@pytest.mark.asyncio
async def test_pump_recovers_from_source_failure() -> None:
    source = FailingOnceSource([visible_message()])
    stop = asyncio.Event()
    logs: list[str] = []
    pump = WeChatMessagePump(
        source,
        WeChatMessageEncoder(IdentityHasher(HMAC_KEY), clock=lambda: NOW),
        poll_interval=0.01,
        clock=lambda: NOW,
        log=logs.append,
    )

    async def publish(_: ChatMessageReceived) -> None:
        stop.set()

    await asyncio.wait_for(pump.run(publish, stop), timeout=1)

    assert source.poll_count == 2
    assert logs == ["WeChat message polling failed: RuntimeError"]
    assert "private source details" not in logs[0]


def test_rejects_short_key_and_invalid_deduplicator_configuration() -> None:
    with pytest.raises(ValueError, match="32 bytes"):
        IdentityHasher(b"short")
    with pytest.raises(ValueError, match="retention"):
        MessageDeduplicator(timedelta(0), 1)
    with pytest.raises(ValueError, match="capacity"):
        MessageDeduplicator(timedelta(minutes=1), 0)
    with pytest.raises(ValueError, match="poll interval"):
        WeChatMessagePump(
            RepeatingSource([]),
            WeChatMessageEncoder(IdentityHasher(HMAC_KEY)),
            poll_interval=0,
        )

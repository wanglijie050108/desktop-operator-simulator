"""Privacy-preserving message ingestion independent of WeChat UI selectors."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import unicodedata
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import uuid4

from .protocol import (
    SCHEMA_VERSION,
    ChatMessageReceived,
    ChatMessageReceivedPayload,
)

DEFAULT_POLL_INTERVAL_SECONDS = 1.0
DEFAULT_MESSAGE_RETENTION = timedelta(hours=1)
DEFAULT_MESSAGE_CAPACITY = 10_000
MAXIMUM_LABEL_LENGTH = 500
MAXIMUM_MESSAGE_LENGTH = 4_000


@dataclass(frozen=True, slots=True)
class VisibleChatMessage:
    conversation_label: str
    sender_label: str
    content: str
    observed_at: datetime
    visible_index: int
    source_message_id: str | None = None

    def __post_init__(self) -> None:
        if not self.conversation_label.strip():
            raise ValueError("Conversation label must not be empty")
        if len(self.conversation_label) > MAXIMUM_LABEL_LENGTH:
            raise ValueError("Conversation label is too long")
        if not self.sender_label.strip():
            raise ValueError("Sender label must not be empty")
        if len(self.sender_label) > MAXIMUM_LABEL_LENGTH:
            raise ValueError("Sender label is too long")
        if not self.content.strip():
            raise ValueError("Message content must not be empty")
        if len(self.content) > MAXIMUM_MESSAGE_LENGTH:
            raise ValueError("Message content is too long")
        if self.observed_at.utcoffset() != timedelta(0):
            raise ValueError("Message observation time must use UTC")
        if self.visible_index < 0:
            raise ValueError("Visible message index must not be negative")
        if self.source_message_id is not None and not self.source_message_id.strip():
            raise ValueError("Source message ID must not be empty")
        if (
            self.source_message_id is not None
            and len(self.source_message_id) > MAXIMUM_LABEL_LENGTH
        ):
            raise ValueError("Source message ID is too long")


class WeChatMessageSource(Protocol):
    async def poll(self) -> Sequence[VisibleChatMessage]: ...


class IdentityHasher:
    def __init__(self, key: bytes) -> None:
        if len(key) < 32:
            raise ValueError("Identity HMAC key must contain at least 32 bytes")
        self._key = key

    def identifier(self, kind: str, value: str) -> str:
        normalized = unicodedata.normalize("NFKC", value).strip()
        digest = hmac.new(
            self._key,
            f"{kind}\0{normalized}".encode(),
            hashlib.sha256,
        ).hexdigest()
        return f"hmac-sha256:{digest}"

    def message_fingerprint(self, message: VisibleChatMessage) -> str:
        material: tuple[str, ...]
        if message.source_message_id is not None:
            material = (
                "source-id-v1",
                _normalize_message_text(message.conversation_label),
                message.source_message_id.strip(),
            )
        else:
            time_bucket = message.observed_at.replace(second=0, microsecond=0)
            material = (
                "visible-message-v1",
                _normalize_message_text(message.conversation_label),
                _normalize_message_text(message.sender_label),
                _normalize_message_text(message.content),
                time_bucket.isoformat(),
                str(message.visible_index),
            )
        digest = hmac.new(
            self._key,
            json.dumps(material, ensure_ascii=False, separators=(",", ":")).encode(),
            hashlib.sha256,
        ).hexdigest()
        return f"wechat:{digest}"


class MessageDeduplicator:
    def __init__(
        self,
        retention: timedelta = DEFAULT_MESSAGE_RETENTION,
        capacity: int = DEFAULT_MESSAGE_CAPACITY,
    ) -> None:
        if retention <= timedelta(0):
            raise ValueError("Message retention must be positive")
        if capacity < 1:
            raise ValueError("Message capacity must be positive")
        self._retention = retention
        self._capacity = capacity
        self._seen: dict[str, datetime] = {}

    def contains(self, message_id: str, now: datetime) -> bool:
        self._remove_expired(now)
        return message_id in self._seen

    def register(self, message_id: str, now: datetime) -> None:
        self._remove_expired(now)
        if message_id in self._seen:
            return
        if len(self._seen) >= self._capacity:
            oldest = min(self._seen, key=self._seen.__getitem__)
            del self._seen[oldest]
        self._seen[message_id] = now

    def _remove_expired(self, now: datetime) -> None:
        expires_before = now - self._retention
        self._seen = {
            message_id: seen_at
            for message_id, seen_at in self._seen.items()
            if seen_at > expires_before
        }


class WeChatMessageEncoder:
    def __init__(
        self,
        identity_hasher: IdentityHasher,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._identity_hasher = identity_hasher
        self._clock = clock or (lambda: datetime.now(UTC))

    def encode(self, message: VisibleChatMessage) -> ChatMessageReceived:
        return ChatMessageReceived(
            schema_version=SCHEMA_VERSION,
            type="chat.message.received",
            message_id=uuid4(),
            timestamp=self._clock(),
            payload=ChatMessageReceivedPayload(
                source="WECHAT",
                external_message_id=self._identity_hasher.message_fingerprint(message),
                conversation_id=self._identity_hasher.identifier(
                    "conversation",
                    message.conversation_label,
                ),
                sender_id=self._identity_hasher.identifier("sender", message.sender_label),
                content=message.content.strip(),
                received_at=message.observed_at,
            ),
        )


class WeChatMessagePump:
    def __init__(
        self,
        source: WeChatMessageSource,
        encoder: WeChatMessageEncoder,
        *,
        deduplicator: MessageDeduplicator | None = None,
        poll_interval: float = DEFAULT_POLL_INTERVAL_SECONDS,
        clock: Callable[[], datetime] | None = None,
        log: Callable[[str], None] | None = None,
    ) -> None:
        if poll_interval <= 0:
            raise ValueError("Message poll interval must be positive")
        self._source = source
        self._encoder = encoder
        self._deduplicator = deduplicator or MessageDeduplicator()
        self._poll_interval = poll_interval
        self._clock = clock or (lambda: datetime.now(UTC))
        self._log = log or (lambda _message: None)

    async def run(
        self,
        publish: Callable[[ChatMessageReceived], Awaitable[None]],
        stop_event: asyncio.Event,
    ) -> None:
        while not stop_event.is_set():
            try:
                messages = await self._source.poll()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self._log(f"WeChat message polling failed: {type(error).__name__}")
            else:
                for visible_message in messages:
                    if stop_event.is_set():
                        break
                    try:
                        message = self._encoder.encode(visible_message)
                    except Exception as error:
                        self._log(f"WeChat message encoding failed: {type(error).__name__}")
                        continue

                    external_id = message.payload.external_message_id
                    now = self._clock()
                    if self._deduplicator.contains(external_id, now):
                        continue
                    try:
                        await publish(message)
                    except asyncio.CancelledError:
                        raise
                    except Exception as error:
                        self._log(f"WeChat message publishing failed: {type(error).__name__}")
                        break
                    self._deduplicator.register(external_id, now)

            try:
                await asyncio.wait_for(stop_event.wait(), timeout=self._poll_interval)
            except TimeoutError:
                continue


def _normalize_message_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split())

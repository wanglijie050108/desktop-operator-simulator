"""Independent command policy and bounded command deduplication."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from .protocol import DesktopCommandPayload

ALL_DESKTOP_ACTIONS = frozenset(
    {
        "WECHAT_READ_NEW_MESSAGES",
        "WECHAT_SEND_TEXT",
        "WINDOW_ACTIVATE",
        "TAKE_SCREENSHOT",
        "CLIPBOARD_SET_TEXT",
        "INPUT_KEY_CHORD",
    }
)
DEFAULT_MAXIMUM_COMMAND_LIFETIME = timedelta(minutes=10)
DEFAULT_DEDUPLICATION_RETENTION = timedelta(hours=1)
DEFAULT_DEDUPLICATION_CAPACITY = 10_000


class AgentCommandPolicy:
    def __init__(
        self,
        allowed_actions: frozenset[str] = ALL_DESKTOP_ACTIONS,
        maximum_command_lifetime: timedelta = DEFAULT_MAXIMUM_COMMAND_LIFETIME,
    ) -> None:
        if not allowed_actions:
            raise ValueError("At least one allowed action must be configured")
        unknown = allowed_actions - ALL_DESKTOP_ACTIONS
        if unknown:
            raise ValueError(f"Unknown desktop action '{sorted(unknown)[0]}'")
        if maximum_command_lifetime <= timedelta(0):
            raise ValueError("Command lifetime must be positive")

        self._allowed_actions = allowed_actions
        self._maximum_command_lifetime = maximum_command_lifetime

    def evaluate(self, command: DesktopCommandPayload, now: datetime) -> str | None:
        if command.action not in self._allowed_actions:
            return "POLICY_DENIED"

        lifetime = command.expires_at - now
        if lifetime <= timedelta(0):
            return "COMMAND_EXPIRED"
        if lifetime > self._maximum_command_lifetime:
            return "COMMAND_EXPIRY_INVALID"
        return None

    @classmethod
    def parse_allowed_actions(cls, comma_separated: str | None) -> frozenset[str]:
        if comma_separated is None or not comma_separated.strip():
            return ALL_DESKTOP_ACTIONS

        selected = frozenset(name.strip() for name in comma_separated.split(",") if name.strip())
        if not selected:
            raise ValueError("At least one allowed action must be configured")
        unknown = selected - ALL_DESKTOP_ACTIONS
        if unknown:
            raise ValueError(f"Unknown desktop action '{sorted(unknown)[0]}'")
        return selected


class CommandDeduplicator:
    def __init__(
        self,
        retention: timedelta = DEFAULT_DEDUPLICATION_RETENTION,
        capacity: int = DEFAULT_DEDUPLICATION_CAPACITY,
    ) -> None:
        if retention <= timedelta(0):
            raise ValueError("Deduplication retention must be positive")
        if capacity < 1:
            raise ValueError("Deduplication capacity must be positive")

        self._retention = retention
        self._capacity = capacity
        self._seen: dict[UUID, datetime] = {}

    def try_register(self, command_id: UUID, now: datetime) -> bool:
        expires_before = now - self._retention
        self._seen = {
            seen_id: seen_at for seen_id, seen_at in self._seen.items() if seen_at > expires_before
        }
        if command_id in self._seen:
            return False

        if len(self._seen) >= self._capacity:
            oldest = min(self._seen, key=self._seen.__getitem__)
            del self._seen[oldest]
        self._seen[command_id] = now
        return True

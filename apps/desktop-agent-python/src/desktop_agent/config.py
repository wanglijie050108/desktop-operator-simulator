"""Configuration for the Python Desktop Agent."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit
from uuid import UUID

from .protocol import AgentCapability

DEFAULT_AGENT_ID = UUID("00000000-0000-4000-8000-000000000001")
DEFAULT_SERVER_URL = "ws://127.0.0.1:7070/ws/agent"
DEFAULT_AGENT_NAME = "python-placeholder-agent"
DEFAULT_AGENT_VERSION = "0.1.0"
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


@dataclass(frozen=True, slots=True)
class AgentOptions:
    server_url: str = DEFAULT_SERVER_URL
    agent_id: UUID = DEFAULT_AGENT_ID
    name: str = DEFAULT_AGENT_NAME
    version: str = DEFAULT_AGENT_VERSION
    capabilities: tuple[AgentCapability, ...] = ()
    initial_reconnect_delay: float = 0.25
    maximum_reconnect_delay: float = 30.0
    handshake_timeout: float = 10.0

    def validate(self) -> None:
        parsed = urlsplit(self.server_url)
        if parsed.scheme not in {"ws", "wss"}:
            raise ValueError("CONTROL_SERVER_WS_URL must use ws or wss")
        if parsed.hostname not in LOOPBACK_HOSTS:
            raise ValueError(
                "CONTROL_SERVER_WS_URL must be loopback until authenticated access exists"
            )
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("CONTROL_SERVER_WS_URL must not contain credentials")
        if self.agent_id.int == 0:
            raise ValueError("AGENT_ID must not be empty")
        if not 1 <= len(self.name) <= 100:
            raise ValueError("AGENT_NAME must contain between 1 and 100 characters")
        if not 1 <= len(self.version) <= 50:
            raise ValueError("Agent version must contain between 1 and 50 characters")
        if self.initial_reconnect_delay <= 0:
            raise ValueError("Initial reconnect delay must be positive")
        if self.maximum_reconnect_delay < self.initial_reconnect_delay:
            raise ValueError("Maximum reconnect delay must not be shorter than the initial delay")
        if self.handshake_timeout <= 0:
            raise ValueError("Handshake timeout must be positive")

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> AgentOptions:
        values = os.environ if environment is None else environment
        raw_agent_id = values.get("AGENT_ID", str(DEFAULT_AGENT_ID))
        try:
            agent_id = UUID(raw_agent_id)
        except ValueError as error:
            raise ValueError("AGENT_ID must be a UUID") from error

        options = cls(
            server_url=values.get("CONTROL_SERVER_WS_URL", DEFAULT_SERVER_URL),
            agent_id=agent_id,
            name=values.get("AGENT_NAME", DEFAULT_AGENT_NAME),
        )
        options.validate()
        return options

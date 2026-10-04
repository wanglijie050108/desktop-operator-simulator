"""Configuration for the Python Desktop Agent."""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

from .policy import ALL_DESKTOP_ACTIONS, AgentCommandPolicy
from .protocol import AgentCapability
from .windows_executor import DisplayProfile

DEFAULT_AGENT_ID = UUID("00000000-0000-4000-8000-000000000001")
DEFAULT_SERVER_URL = "ws://127.0.0.1:7070/ws/agent"
DEFAULT_AGENT_NAME = "python-placeholder-agent"
DEFAULT_AGENT_VERSION = "0.1.0"
DEFAULT_ARTIFACT_DIRECTORY = Path("data/artifacts/desktop-agent")
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
PROCESS_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
COORDINATE_MOUSE_PROFILE_PATTERN = re.compile(
    r"^(?P<width>\d{3,5})x(?P<height>\d{3,5})@(?P<dpi>\d{2,3})$"
)


def _parse_boolean(name: str, value: str | None, *, default: bool) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    raise ValueError(f"{name} must be true or false")


def _parse_allowed_processes(value: str | None) -> frozenset[str]:
    if value is None or not value.strip():
        return frozenset()

    processes = frozenset(name.strip().casefold() for name in value.split(",") if name.strip())
    if not processes:
        return frozenset()
    invalid = sorted(name for name in processes if PROCESS_NAME_PATTERN.fullmatch(name) is None)
    if invalid:
        raise ValueError(f"Invalid allowed process name '{invalid[0]}'")
    return processes


def _parse_coordinate_mouse_profile(value: str | None) -> DisplayProfile | None:
    """Parse ``WIDTHxHEIGHT@DPI``.

    Absent or empty means coordinate clicks stay disabled: window-relative coordinates are only
    safe against the display profile they were calibrated on.
    """

    if value is None or not value.strip():
        return None
    match = COORDINATE_MOUSE_PROFILE_PATTERN.fullmatch(value.strip())
    if match is None:
        raise ValueError("AGENT_COORDINATE_MOUSE_PROFILE must use the WIDTHxHEIGHT@DPI format")
    profile = DisplayProfile(
        width=int(match.group("width")),
        height=int(match.group("height")),
        dpi=int(match.group("dpi")),
    )
    if not 320 <= profile.width <= 20_000 or not 200 <= profile.height <= 20_000:
        raise ValueError("AGENT_COORDINATE_MOUSE_PROFILE resolution is out of range")
    if not 48 <= profile.dpi <= 480:
        raise ValueError("AGENT_COORDINATE_MOUSE_PROFILE dpi is out of range")
    return profile


@dataclass(frozen=True, slots=True)
class AgentOptions:
    server_url: str = DEFAULT_SERVER_URL
    agent_id: UUID = DEFAULT_AGENT_ID
    name: str = DEFAULT_AGENT_NAME
    version: str = DEFAULT_AGENT_VERSION
    capabilities: tuple[AgentCapability, ...] = ()
    allowed_actions: frozenset[str] = ALL_DESKTOP_ACTIONS
    windows_automation_enabled: bool = False
    allowed_processes: frozenset[str] = frozenset()
    coordinate_mouse_profile: DisplayProfile | None = None
    wechat_ingress_enabled: bool = False
    wechat_send_enabled: bool = False
    wechat_process_name: str = "WeChat.exe"
    identity_key: bytes = b""
    artifact_directory: Path = DEFAULT_ARTIFACT_DIRECTORY
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
        AgentCommandPolicy(self.allowed_actions)
        if self.windows_automation_enabled and not self.allowed_processes:
            raise ValueError(
                "AGENT_ALLOWED_PROCESSES is required when Windows automation is enabled"
            )
        if (self.wechat_ingress_enabled or self.wechat_send_enabled) and (
            not self.windows_automation_enabled
        ):
            raise ValueError(
                "AGENT_WECHAT_INGRESS_ENABLED / AGENT_WECHAT_SEND_ENABLED require "
                "AGENT_WINDOWS_AUTOMATION_ENABLED"
            )
        if not PROCESS_NAME_PATTERN.fullmatch(self.wechat_process_name):
            raise ValueError("AGENT_WECHAT_PROCESS must be a valid process name")
        if self.wechat_ingress_enabled and len(self.identity_key) < 32:
            raise ValueError(
                "AGENT_IDENTITY_KEY must contain at least 32 bytes when WeChat ingress is enabled"
            )

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> AgentOptions:
        values = os.environ if environment is None else environment
        raw_agent_id = values.get("AGENT_ID", str(DEFAULT_AGENT_ID))
        try:
            agent_id = UUID(raw_agent_id)
        except ValueError as error:
            raise ValueError("AGENT_ID must be a UUID") from error

        windows_automation_enabled = _parse_boolean(
            "AGENT_WINDOWS_AUTOMATION_ENABLED",
            values.get("AGENT_WINDOWS_AUTOMATION_ENABLED"),
            default=False,
        )
        wechat_ingress_enabled = _parse_boolean(
            "AGENT_WECHAT_INGRESS_ENABLED",
            values.get("AGENT_WECHAT_INGRESS_ENABLED"),
            default=False,
        )
        wechat_send_enabled = _parse_boolean(
            "AGENT_WECHAT_SEND_ENABLED",
            values.get("AGENT_WECHAT_SEND_ENABLED"),
            default=False,
        )
        wechat_process_name = values.get("AGENT_WECHAT_PROCESS", "WeChat.exe")
        raw_identity_key = values.get("AGENT_IDENTITY_KEY")
        identity_key = bytes.fromhex(raw_identity_key) if raw_identity_key else b""
        artifact_directory_text = values.get(
            "AGENT_ARTIFACT_DIR",
            str(DEFAULT_ARTIFACT_DIRECTORY),
        )
        if not artifact_directory_text.strip():
            raise ValueError("AGENT_ARTIFACT_DIR must not be empty")
        capabilities: list[AgentCapability] = []
        if windows_automation_enabled:
            capabilities.extend(
                (
                    AgentCapability.INPUT,
                    AgentCapability.MOUSE,
                    AgentCapability.CLIPBOARD,
                    AgentCapability.SCREENSHOT,
                )
            )
            if wechat_ingress_enabled:
                capabilities.append(AgentCapability.WECHAT_READ)
            if wechat_send_enabled:
                capabilities.append(AgentCapability.WECHAT_SEND)
        options = cls(
            server_url=values.get("CONTROL_SERVER_WS_URL", DEFAULT_SERVER_URL),
            agent_id=agent_id,
            name=values.get("AGENT_NAME", DEFAULT_AGENT_NAME),
            capabilities=tuple(capabilities),
            allowed_actions=AgentCommandPolicy.parse_allowed_actions(
                values.get("AGENT_ALLOWED_ACTIONS")
            ),
            windows_automation_enabled=windows_automation_enabled,
            allowed_processes=_parse_allowed_processes(values.get("AGENT_ALLOWED_PROCESSES")),
            coordinate_mouse_profile=_parse_coordinate_mouse_profile(
                values.get("AGENT_COORDINATE_MOUSE_PROFILE")
            ),
            wechat_ingress_enabled=wechat_ingress_enabled,
            wechat_send_enabled=wechat_send_enabled,
            wechat_process_name=wechat_process_name,
            identity_key=identity_key,
            artifact_directory=Path(artifact_directory_text),
        )
        options.validate()
        return options

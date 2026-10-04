"""Strict WebSocket protocol models shared with the Control Server."""

from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Final, Literal, TypeAlias
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    field_validator,
)

SCHEMA_VERSION: Final = "1.0"
MAXIMUM_MESSAGE_BYTES = 64 * 1024
UTC_TIMESTAMP_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$")


def _non_empty_uuid(value: UUID) -> UUID:
    if value.int == 0:
        raise ValueError("UUID must not be empty")
    return value


def _parse_utc_timestamp(value: object) -> datetime:
    if isinstance(value, datetime):
        offset = value.utcoffset()
        if offset is None or offset.total_seconds() != 0:
            raise ValueError("timestamp must use UTC")
        return value
    if not isinstance(value, str) or UTC_TIMESTAMP_PATTERN.fullmatch(value) is None:
        raise ValueError("timestamp must use UTC")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


NonEmptyUuid: TypeAlias = Annotated[UUID, AfterValidator(_non_empty_uuid)]
UtcTimestamp: TypeAlias = Annotated[datetime, BeforeValidator(_parse_utc_timestamp)]
NameText: TypeAlias = Annotated[str, StringConstraints(min_length=1, max_length=100)]
VersionText: TypeAlias = Annotated[str, StringConstraints(min_length=1, max_length=50)]
IdentifierText: TypeAlias = Annotated[str, StringConstraints(min_length=1, max_length=200)]
ExternalMessageId: TypeAlias = Annotated[str, StringConstraints(min_length=1, max_length=500)]
ContentText: TypeAlias = Annotated[str, StringConstraints(min_length=1, max_length=4_000)]
OptionalContentText: TypeAlias = Annotated[str, StringConstraints(max_length=4_000)]
ErrorCode: TypeAlias = Annotated[str, StringConstraints(min_length=1, max_length=100)]
ErrorMessage: TypeAlias = Annotated[str, StringConstraints(min_length=1, max_length=500)]
ArtifactName: TypeAlias = Annotated[
    str,
    StringConstraints(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$"),
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True, strict=True)


class AgentCapability(StrEnum):
    WECHAT_READ = "wechat.read"
    WECHAT_SEND = "wechat.send"
    INPUT = "input"
    MOUSE = "mouse"
    CLIPBOARD = "clipboard"
    SCREENSHOT = "screenshot"


class AgentStatus(StrEnum):
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"
    PAUSED = "PAUSED"
    BUSY = "BUSY"


class CommandOutcome(StrEnum):
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    REJECTED = "REJECTED"


class InputKey(StrEnum):
    CTRL = "CTRL"
    ALT = "ALT"
    SHIFT = "SHIFT"
    ENTER = "ENTER"
    ESCAPE = "ESCAPE"
    A = "A"
    C = "C"
    V = "V"


class MouseButton(StrEnum):
    LEFT = "LEFT"
    RIGHT = "RIGHT"
    MIDDLE = "MIDDLE"


class ProtocolEnvelope(StrictModel):
    schema_version: Literal["1.0"] = Field(alias="schemaVersion")
    message_id: NonEmptyUuid = Field(alias="messageId")
    timestamp: UtcTimestamp


class AgentHelloPayload(StrictModel):
    agent_id: NonEmptyUuid = Field(alias="agentId")
    name: NameText
    version: VersionText
    capabilities: list[AgentCapability]

    @field_validator("capabilities")
    @classmethod
    def capabilities_must_be_unique(cls, value: list[AgentCapability]) -> list[AgentCapability]:
        if len(value) != len(set(value)):
            raise ValueError("capabilities must be unique")
        return value


class AgentHeartbeatPayload(StrictModel):
    agent_id: NonEmptyUuid = Field(alias="agentId")
    status: AgentStatus
    active_command_id: NonEmptyUuid | None = Field(default=None, alias="activeCommandId")


class ChatMessageReceivedPayload(StrictModel):
    source: Literal["WECHAT"]
    external_message_id: ExternalMessageId = Field(alias="externalMessageId")
    conversation_id: IdentifierText = Field(alias="conversationId")
    sender_id: IdentifierText = Field(alias="senderId")
    content: ContentText
    received_at: UtcTimestamp = Field(alias="receivedAt")


class ServerWelcomePayload(StrictModel):
    heartbeat_interval_ms: Annotated[int, Field(ge=1_000, le=60_000)] = Field(
        alias="heartbeatIntervalMs"
    )
    server_version: VersionText = Field(alias="serverVersion")


class EmptyArguments(StrictModel):
    pass


class WeChatSendTextArguments(StrictModel):
    conversation_id: IdentifierText = Field(alias="conversationId")
    text: ContentText


class WindowActivateArguments(StrictModel):
    process_name: NameText = Field(alias="processName")
    title_contains: Annotated[str, StringConstraints(min_length=1, max_length=200)] | None = Field(
        default=None, alias="titleContains"
    )


class TakeScreenshotArguments(StrictModel):
    artifact_name: ArtifactName = Field(alias="artifactName")


class ClipboardSetTextArguments(StrictModel):
    text: OptionalContentText


class InputKeyChordArguments(StrictModel):
    keys: Annotated[list[InputKey], Field(min_length=1, max_length=4)]

    @field_validator("keys")
    @classmethod
    def keys_must_be_unique(cls, value: list[InputKey]) -> list[InputKey]:
        if len(value) != len(set(value)):
            raise ValueError("keys must be unique")
        return value


ShortText: TypeAlias = Annotated[str, StringConstraints(min_length=1, max_length=200)]


class WindowSelector(StrictModel):
    process_name: NameText = Field(alias="processName")
    title_contains: ShortText | None = Field(default=None, alias="titleContains")


class ControlLocator(WindowSelector):
    """Semantic UIA locator.

    Offsets are relative to the located element and never absolute screen coordinates, so a
    moved or resized window cannot silently redirect input to another application.
    """

    control_type: Annotated[str, StringConstraints(min_length=1, max_length=50)] | None = Field(
        default=None, alias="controlType"
    )
    automation_id: ShortText | None = Field(default=None, alias="automationId")
    name: ShortText | None = Field(default=None)
    index: Annotated[int, Field(ge=0, le=99)] | None = Field(default=None)
    offset_x: Annotated[int, Field(ge=-2_000, le=2_000)] | None = Field(
        default=None, alias="offsetX"
    )
    offset_y: Annotated[int, Field(ge=-2_000, le=2_000)] | None = Field(
        default=None, alias="offsetY"
    )


class MouseMoveArguments(StrictModel):
    target: ControlLocator


class MouseClickArguments(StrictModel):
    target: ControlLocator
    button: MouseButton = MouseButton.LEFT
    click_count: Annotated[int, Field(ge=1, le=2)] = Field(default=1, alias="clickCount")


class MouseDragArguments(StrictModel):
    from_control: ControlLocator = Field(alias="from")
    to_control: ControlLocator = Field(alias="to")
    button: MouseButton = MouseButton.LEFT


class MouseScrollArguments(StrictModel):
    target: ControlLocator
    vertical_delta: Annotated[int, Field(ge=-20, le=20)] = Field(alias="verticalDelta")

    @field_validator("vertical_delta")
    @classmethod
    def ticks_must_not_be_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("verticalDelta must not be zero")
        return value


class MouseClickPositionArguments(StrictModel):
    target: WindowSelector
    x: Annotated[int, Field(ge=0, le=20_000)]
    y: Annotated[int, Field(ge=0, le=20_000)]
    button: MouseButton = MouseButton.LEFT
    click_count: Annotated[int, Field(ge=1, le=2)] = Field(default=1, alias="clickCount")


class CommandPayloadBase(StrictModel):
    command_id: NonEmptyUuid = Field(alias="commandId")
    task_id: NonEmptyUuid = Field(alias="taskId")
    expires_at: UtcTimestamp = Field(alias="expiresAt")


class WeChatReadNewMessagesPayload(CommandPayloadBase):
    action: Literal["WECHAT_READ_NEW_MESSAGES"]
    arguments: EmptyArguments


class WeChatSendTextPayload(CommandPayloadBase):
    action: Literal["WECHAT_SEND_TEXT"]
    arguments: WeChatSendTextArguments


class WindowActivatePayload(CommandPayloadBase):
    action: Literal["WINDOW_ACTIVATE"]
    arguments: WindowActivateArguments


class TakeScreenshotPayload(CommandPayloadBase):
    action: Literal["TAKE_SCREENSHOT"]
    arguments: TakeScreenshotArguments


class ClipboardSetTextPayload(CommandPayloadBase):
    action: Literal["CLIPBOARD_SET_TEXT"]
    arguments: ClipboardSetTextArguments


class InputKeyChordPayload(CommandPayloadBase):
    action: Literal["INPUT_KEY_CHORD"]
    arguments: InputKeyChordArguments


class MouseMovePayload(CommandPayloadBase):
    action: Literal["MOUSE_MOVE"]
    arguments: MouseMoveArguments


class MouseClickPayload(CommandPayloadBase):
    action: Literal["MOUSE_CLICK"]
    arguments: MouseClickArguments


class MouseDragPayload(CommandPayloadBase):
    action: Literal["MOUSE_DRAG"]
    arguments: MouseDragArguments


class MouseScrollPayload(CommandPayloadBase):
    action: Literal["MOUSE_SCROLL"]
    arguments: MouseScrollArguments


class MouseClickPositionPayload(CommandPayloadBase):
    action: Literal["MOUSE_CLICK_POSITION"]
    arguments: MouseClickPositionArguments


DesktopCommandPayload: TypeAlias = Annotated[
    WeChatReadNewMessagesPayload
    | WeChatSendTextPayload
    | WindowActivatePayload
    | TakeScreenshotPayload
    | ClipboardSetTextPayload
    | InputKeyChordPayload
    | MouseMovePayload
    | MouseClickPayload
    | MouseDragPayload
    | MouseScrollPayload
    | MouseClickPositionPayload,
    Field(discriminator="action"),
]


class DesktopCommandResultPayload(StrictModel):
    command_id: NonEmptyUuid = Field(alias="commandId")
    task_id: NonEmptyUuid = Field(alias="taskId")
    outcome: CommandOutcome
    error_code: ErrorCode | None = Field(default=None, alias="errorCode")


class TaskCancelPayload(StrictModel):
    task_id: NonEmptyUuid = Field(alias="taskId")


class EmergencyStopPayload(StrictModel):
    reason: ErrorMessage


class ProtocolErrorPayload(StrictModel):
    code: Literal[
        "INVALID_MESSAGE",
        "SCHEMA_VERSION_UNSUPPORTED",
        "AGENT_NOT_REGISTERED",
        "AGENT_ID_MISMATCH",
    ]
    message: ErrorMessage


class AgentHello(ProtocolEnvelope):
    type: Literal["agent.hello"]
    payload: AgentHelloPayload


class AgentHeartbeat(ProtocolEnvelope):
    type: Literal["agent.heartbeat"]
    payload: AgentHeartbeatPayload


class ChatMessageReceived(ProtocolEnvelope):
    type: Literal["chat.message.received"]
    payload: ChatMessageReceivedPayload


class DesktopCommandResult(ProtocolEnvelope):
    type: Literal["desktop.command.result"]
    payload: DesktopCommandResultPayload


class ServerWelcome(ProtocolEnvelope):
    type: Literal["server.welcome"]
    payload: ServerWelcomePayload


class DesktopCommand(ProtocolEnvelope):
    type: Literal["desktop.command"]
    payload: DesktopCommandPayload


class TaskCancel(ProtocolEnvelope):
    type: Literal["task.cancel"]
    payload: TaskCancelPayload


class EmergencyStop(ProtocolEnvelope):
    type: Literal["system.emergency-stop"]
    payload: EmergencyStopPayload


class ProtocolError(ProtocolEnvelope):
    type: Literal["server.error"]
    payload: ProtocolErrorPayload


AgentToServerMessage: TypeAlias = Annotated[
    AgentHello | AgentHeartbeat | ChatMessageReceived | DesktopCommandResult,
    Field(discriminator="type"),
]
ServerToAgentMessage: TypeAlias = Annotated[
    ServerWelcome | DesktopCommand | TaskCancel | EmergencyStop | ProtocolError,
    Field(discriminator="type"),
]

_AGENT_MESSAGE_ADAPTER: TypeAdapter[AgentToServerMessage] = TypeAdapter(AgentToServerMessage)
_SERVER_MESSAGE_ADAPTER: TypeAdapter[ServerToAgentMessage] = TypeAdapter(ServerToAgentMessage)


def _ensure_message_size(raw: bytes | str) -> None:
    size = len(raw) if isinstance(raw, bytes) else len(raw.encode("utf-8"))
    if size > MAXIMUM_MESSAGE_BYTES:
        raise ValueError("WebSocket message exceeds the size limit")


def parse_agent_message(raw: bytes | str) -> AgentToServerMessage:
    _ensure_message_size(raw)
    return _AGENT_MESSAGE_ADAPTER.validate_json(raw, strict=True, by_alias=True, by_name=False)


def parse_server_message(raw: bytes | str) -> ServerToAgentMessage:
    _ensure_message_size(raw)
    return _SERVER_MESSAGE_ADAPTER.validate_json(raw, strict=True, by_alias=True, by_name=False)


def serialize_message(message: ProtocolEnvelope) -> str:
    encoded = message.model_dump_json(by_alias=True, exclude_none=True)
    _ensure_message_size(encoded)
    return encoded

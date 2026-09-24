import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const SCHEMA_VERSION = "1.0" as const;

const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const UTC_TIMESTAMP_PATTERN =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00)$";

export const UuidSchema = Type.String({ pattern: UUID_PATTERN });
export const UtcTimestampSchema = Type.String({ pattern: UTC_TIMESTAMP_PATTERN });

export const AgentCapabilitySchema = Type.Union([
  Type.Literal("wechat.read"),
  Type.Literal("wechat.send"),
  Type.Literal("input"),
  Type.Literal("clipboard"),
  Type.Literal("screenshot"),
]);

export const AgentStatusSchema = Type.Union([
  Type.Literal("ONLINE"),
  Type.Literal("OFFLINE"),
  Type.Literal("PAUSED"),
  Type.Literal("BUSY"),
]);

const envelopeFields = {
  schemaVersion: Type.Literal(SCHEMA_VERSION),
  messageId: UuidSchema,
  timestamp: UtcTimestampSchema,
};

export const AgentHelloSchema = Type.Object(
  {
    ...envelopeFields,
    type: Type.Literal("agent.hello"),
    payload: Type.Object(
      {
        agentId: UuidSchema,
        name: Type.String({ minLength: 1, maxLength: 100 }),
        version: Type.String({ minLength: 1, maxLength: 50 }),
        capabilities: Type.Array(AgentCapabilitySchema, { uniqueItems: true }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const AgentHeartbeatSchema = Type.Object(
  {
    ...envelopeFields,
    type: Type.Literal("agent.heartbeat"),
    payload: Type.Object(
      {
        agentId: UuidSchema,
        status: AgentStatusSchema,
        activeCommandId: Type.Optional(UuidSchema),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const ChatMessageReceivedSchema = Type.Object(
  {
    ...envelopeFields,
    type: Type.Literal("chat.message.received"),
    payload: Type.Object(
      {
        source: Type.Literal("WECHAT"),
        externalMessageId: Type.String({ minLength: 1, maxLength: 500 }),
        conversationId: Type.String({ minLength: 1, maxLength: 200 }),
        senderId: Type.String({ minLength: 1, maxLength: 200 }),
        content: Type.String({ minLength: 1, maxLength: 4_000 }),
        receivedAt: UtcTimestampSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const ServerWelcomeSchema = Type.Object(
  {
    ...envelopeFields,
    type: Type.Literal("server.welcome"),
    payload: Type.Object(
      {
        heartbeatIntervalMs: Type.Integer({ minimum: 1_000, maximum: 60_000 }),
        serverVersion: Type.String({ minLength: 1, maxLength: 50 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const desktopCommandBase = {
  ...envelopeFields,
  type: Type.Literal("desktop.command"),
};

const commandPayloadBase = {
  commandId: UuidSchema,
  taskId: UuidSchema,
  expiresAt: UtcTimestampSchema,
};

export const DesktopCommandSchema = Type.Union([
  Type.Object(
    {
      ...desktopCommandBase,
      payload: Type.Object(
        {
          ...commandPayloadBase,
          action: Type.Literal("WECHAT_READ_NEW_MESSAGES"),
          arguments: Type.Object({}, { additionalProperties: false }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...desktopCommandBase,
      payload: Type.Object(
        {
          ...commandPayloadBase,
          action: Type.Literal("WECHAT_SEND_TEXT"),
          arguments: Type.Object(
            {
              conversationId: Type.String({ minLength: 1, maxLength: 200 }),
              text: Type.String({ minLength: 1, maxLength: 4_000 }),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...desktopCommandBase,
      payload: Type.Object(
        {
          ...commandPayloadBase,
          action: Type.Literal("WINDOW_ACTIVATE"),
          arguments: Type.Object(
            {
              processName: Type.String({ minLength: 1, maxLength: 100 }),
              titleContains: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...desktopCommandBase,
      payload: Type.Object(
        {
          ...commandPayloadBase,
          action: Type.Literal("TAKE_SCREENSHOT"),
          arguments: Type.Object(
            {
              artifactName: Type.String({
                minLength: 1,
                maxLength: 100,
                pattern: "^[a-zA-Z0-9_-]+$",
              }),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...desktopCommandBase,
      payload: Type.Object(
        {
          ...commandPayloadBase,
          action: Type.Literal("CLIPBOARD_SET_TEXT"),
          arguments: Type.Object(
            {
              text: Type.String({ maxLength: 4_000 }),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...desktopCommandBase,
      payload: Type.Object(
        {
          ...commandPayloadBase,
          action: Type.Literal("INPUT_KEY_CHORD"),
          arguments: Type.Object(
            {
              keys: Type.Array(
                Type.Union([
                  Type.Literal("CTRL"),
                  Type.Literal("ALT"),
                  Type.Literal("SHIFT"),
                  Type.Literal("ENTER"),
                  Type.Literal("ESCAPE"),
                  Type.Literal("A"),
                  Type.Literal("C"),
                  Type.Literal("V"),
                ]),
                { minItems: 1, maxItems: 4, uniqueItems: true },
              ),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);

export const DesktopCommandResultSchema = Type.Object(
  {
    ...envelopeFields,
    type: Type.Literal("desktop.command.result"),
    payload: Type.Object(
      {
        commandId: UuidSchema,
        taskId: UuidSchema,
        outcome: Type.Union([
          Type.Literal("SUCCEEDED"),
          Type.Literal("FAILED"),
          Type.Literal("REJECTED"),
        ]),
        errorCode: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const TaskCancelSchema = Type.Object(
  {
    ...envelopeFields,
    type: Type.Literal("task.cancel"),
    payload: Type.Object(
      {
        taskId: UuidSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const EmergencyStopSchema = Type.Object(
  {
    ...envelopeFields,
    type: Type.Literal("system.emergency-stop"),
    payload: Type.Object(
      {
        reason: Type.String({ minLength: 1, maxLength: 500 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const ProtocolErrorSchema = Type.Object(
  {
    ...envelopeFields,
    type: Type.Literal("server.error"),
    payload: Type.Object(
      {
        code: Type.Union([
          Type.Literal("INVALID_MESSAGE"),
          Type.Literal("SCHEMA_VERSION_UNSUPPORTED"),
          Type.Literal("AGENT_NOT_REGISTERED"),
          Type.Literal("AGENT_ID_MISMATCH"),
        ]),
        message: Type.String({ minLength: 1, maxLength: 500 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const AgentToServerMessageSchema = Type.Union([
  AgentHelloSchema,
  AgentHeartbeatSchema,
  ChatMessageReceivedSchema,
  DesktopCommandResultSchema,
]);

export const ServerToAgentMessageSchema = Type.Union([
  ServerWelcomeSchema,
  DesktopCommandSchema,
  TaskCancelSchema,
  EmergencyStopSchema,
  ProtocolErrorSchema,
]);

export type AgentCapability = Static<typeof AgentCapabilitySchema>;
export type AgentStatus = Static<typeof AgentStatusSchema>;
export type AgentHello = Static<typeof AgentHelloSchema>;
export type AgentHeartbeat = Static<typeof AgentHeartbeatSchema>;
export type ChatMessageReceived = Static<typeof ChatMessageReceivedSchema>;
export type ServerWelcome = Static<typeof ServerWelcomeSchema>;
export type DesktopCommand = Static<typeof DesktopCommandSchema>;
export type DesktopCommandResult = Static<typeof DesktopCommandResultSchema>;
export type TaskCancel = Static<typeof TaskCancelSchema>;
export type EmergencyStop = Static<typeof EmergencyStopSchema>;
export type ProtocolError = Static<typeof ProtocolErrorSchema>;
export type AgentToServerMessage = Static<typeof AgentToServerMessageSchema>;
export type ServerToAgentMessage = Static<typeof ServerToAgentMessageSchema>;

export function isSchemaValue<T extends TSchema>(schema: T, value: unknown): value is Static<T> {
  return Value.Check(schema, value);
}

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status", {
    enum: ["ONLINE", "OFFLINE", "PAUSED", "BUSY"],
  }).notNull(),
  capabilitiesJson: text("capabilities_json").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  version: text("version").notNull(),
  connectedAt: text("connected_at").notNull(),
});

export const desktopCommands = sqliteTable("desktop_commands", {
  commandId: text("command_id").primaryKey(),
  taskId: text("task_id").notNull(),
  action: text("action").notNull(),
  state: text("state", {
    enum: ["PENDING", "SUCCEEDED", "FAILED", "REJECTED", "CANCELLED"],
  }).notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
  errorCode: text("error_code"),
});

export const inboundMessages = sqliteTable(
  "inbound_messages",
  {
    id: text("id").primaryKey(),
    source: text("source", { enum: ["WECHAT"] }).notNull(),
    externalMessageId: text("external_message_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    senderId: text("sender_id").notNull(),
    content: text("content").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (table) => [
    uniqueIndex("inbound_messages_source_identity_idx").on(
      table.source,
      table.conversationId,
      table.externalMessageId,
    ),
  ],
);

export const trustedSenders = sqliteTable("trusted_senders", {
  senderId: text("sender_id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    shortCode: text("short_code").notNull().unique(),
    type: text("type", { enum: ["AI_QUESTION", "PRODUCT_SEARCH"] }).notNull(),
    state: text("state", {
      enum: [
        "RECEIVED",
        "PLANNED",
        "WAITING_FOR_INPUT",
        "RUNNING",
        "WAITING_FOR_HUMAN",
        "SUCCEEDED",
        "FAILED",
        "CANCELLED",
        "REJECTED",
        "INTERRUPTED",
      ],
    }).notNull(),
    requestJson: text("request_json").notNull(),
    resultJson: text("result_json"),
    policyVersion: text("policy_version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("tasks_state_idx").on(table.state)],
);

export const taskSteps = sqliteTable(
  "task_steps",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    name: text("name").notNull(),
    state: text("state", {
      enum: ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"],
    }).notNull(),
    attempt: integer("attempt").notNull().default(0),
    errorCode: text("error_code"),
    artifactRefsJson: text("artifact_refs_json").notNull().default("[]"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [uniqueIndex("task_steps_task_sequence_idx").on(table.taskId, table.sequence)],
);

export const confirmations = sqliteTable(
  "confirmations",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    confirmedBy: text("confirmed_by").notNull(),
    confirmedAt: text("confirmed_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    nonce: text("nonce").notNull().unique(),
    consumedAt: text("consumed_at"),
  },
  (table) => [index("confirmations_task_id_idx").on(table.taskId)],
);

export const schemaMigrations = sqliteTable("schema_migrations", {
  version: integer("version").primaryKey(),
  name: text("name").notNull(),
  appliedAt: text("applied_at").notNull(),
});

export const databaseSchema = {
  agents,
  confirmations,
  desktopCommands,
  inboundMessages,
  schemaMigrations,
  taskSteps,
  tasks,
  trustedSenders,
};

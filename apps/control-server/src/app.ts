import { randomUUID } from "node:crypto";

import websocket from "@fastify/websocket";
import { AgentCapabilitySchema, AgentStatusSchema } from "@hos/contracts";
import { Type } from "@sinclair/typebox";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import {
  type AiQuestionAdapter,
  UnavailableAiQuestionAdapter,
} from "./adapters/ai-question-adapter.js";
import {
  type ChatReplyAdapter,
  UnavailableChatReplyAdapter,
} from "./adapters/chat-reply-adapter.js";
import {
  type ProductSearchAdapter,
  UnavailableProductSearchAdapter,
} from "./adapters/product-search-adapter.js";
import { AgentGateway } from "./application/agent-gateway.js";
import { AiQuestionWorkflow } from "./application/ai-question-workflow.js";
import { ArtifactCleanupService } from "./application/artifact-cleanup.js";
import { AssistantWorkflow } from "./application/assistant-workflow.js";
import { ProductSearchWorkflow } from "./application/product-search-workflow.js";
import { TaskReaper } from "./application/task-reaper.js";
import { AiQuestionCommandPolicy } from "./domain/ai-question-command.js";
import { redactError } from "./domain/redaction.js";
import { RetryPolicy } from "./domain/retry-policy.js";
import { AgentRepository } from "./infrastructure/database/agent-repository.js";
import { CommandRepository } from "./infrastructure/database/command-repository.js";
import { openDatabase } from "./infrastructure/database/database.js";
import { InboundMessageRepository } from "./infrastructure/database/inbound-message-repository.js";
import { TaskRepository, type TaskState } from "./infrastructure/database/task-repository.js";
import { TrustedSenderRepository } from "./infrastructure/database/trusted-sender-repository.js";

declare module "fastify" {
  interface FastifyInstance {
    agentGateway: AgentGateway;
    aiQuestionWorkflow: AiQuestionWorkflow;
    artifactCleanup: ArtifactCleanupService;
    assistantWorkflow: AssistantWorkflow;
    productSearchWorkflow: ProductSearchWorkflow;
    taskReaper: TaskReaper;
  }
}

const serviceVersion = "0.1.0";

const healthResponseSchema = Type.Object(
  {
    status: Type.Literal("ok"),
    version: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const agentSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
    status: AgentStatusSchema,
    capabilities: Type.Array(AgentCapabilitySchema),
    lastSeenAt: Type.String({ format: "date-time" }),
    version: Type.String(),
  },
  { additionalProperties: false },
);

const acceptedResponseSchema = Type.Object(
  {
    accepted: Type.Literal(true),
    notifiedAgents: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const taskStateSchema = Type.Union([
  Type.Literal("RECEIVED"),
  Type.Literal("PLANNED"),
  Type.Literal("WAITING_FOR_INPUT"),
  Type.Literal("RUNNING"),
  Type.Literal("WAITING_FOR_HUMAN"),
  Type.Literal("SUCCEEDED"),
  Type.Literal("FAILED"),
  Type.Literal("CANCELLED"),
  Type.Literal("REJECTED"),
  Type.Literal("INTERRUPTED"),
]);

const taskStepSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    taskId: Type.String({ format: "uuid" }),
    sequence: Type.Integer({ minimum: 1 }),
    name: Type.String(),
    state: Type.Union([
      Type.Literal("PENDING"),
      Type.Literal("RUNNING"),
      Type.Literal("SUCCEEDED"),
      Type.Literal("FAILED"),
      Type.Literal("SKIPPED"),
    ]),
    attempt: Type.Integer({ minimum: 0 }),
    errorCode: Type.Union([Type.String(), Type.Null()]),
    artifactRefs: Type.Array(Type.Unknown()),
    startedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    finishedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  },
  { additionalProperties: false },
);

const aiQuestionResultSchema = Type.Object(
  {
    answer: Type.String(),
    durationMs: Type.Integer({ minimum: 0 }),
    source: Type.String(),
  },
  { additionalProperties: false },
);

const productCandidateSchema = Type.Object(
  {
    attributes: Type.Record(Type.String(), Type.String()),
    collectedAt: Type.String({ format: "date-time" }),
    price: Type.Number({ exclusiveMinimum: 0 }),
    rank: Type.Integer({ minimum: 1, maximum: 3 }),
    rating: Type.Union([Type.Number({ minimum: 0, maximum: 5 }), Type.Null()]),
    salesText: Type.Union([Type.String(), Type.Null()]),
    score: Type.Number({ minimum: 0, maximum: 1 }),
    shopName: Type.Union([Type.String(), Type.Null()]),
    title: Type.String(),
    url: Type.String({ format: "uri" }),
  },
  { additionalProperties: false },
);

const productSearchResultSchema = Type.Object(
  {
    adapterVersion: Type.String(),
    collectedAt: Type.String({ format: "date-time" }),
    maxPrice: Type.Number({ exclusiveMinimum: 0 }),
    products: Type.Array(productCandidateSchema, { minItems: 1, maxItems: 3 }),
    query: Type.String(),
    source: Type.String(),
  },
  { additionalProperties: false },
);

const taskSourceSchema = Type.Literal("WECHAT");
const missingProductFieldsSchema = Type.Array(
  Type.Union([Type.Literal("query"), Type.Literal("maxPrice"), Type.Literal("candidateCount")]),
);
const taskRequestSchema = Type.Union([
  Type.Object(
    {
      conversationId: Type.String(),
      question: Type.String(),
      source: taskSourceSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      candidateCount: Type.Integer({ minimum: 1, maximum: 3 }),
      conversationId: Type.String(),
      maxPrice: Type.Number({ exclusiveMinimum: 0 }),
      preferences: Type.Array(Type.String(), { maxItems: 5 }),
      query: Type.String(),
      source: taskSourceSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      conversationId: Type.String(),
      missingFields: missingProductFieldsSchema,
      source: taskSourceSchema,
    },
    { additionalProperties: false },
  ),
]);

const taskErrorResultSchema = Type.Object(
  {
    errorCode: Type.String(),
    missingFields: Type.Optional(missingProductFieldsSchema),
  },
  { additionalProperties: false },
);

const taskSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    shortCode: Type.String(),
    type: Type.Union([Type.Literal("AI_QUESTION"), Type.Literal("PRODUCT_SEARCH")]),
    state: taskStateSchema,
    request: taskRequestSchema,
    result: Type.Union([
      aiQuestionResultSchema,
      productSearchResultSchema,
      taskErrorResultSchema,
      Type.Null(),
    ]),
    policyVersion: Type.String(),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    steps: Type.Array(taskStepSchema),
  },
  { additionalProperties: false },
);

const errorSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
);

export interface BuildAppOptions {
  aiAdapter?: AiQuestionAdapter;
  allowedShoppingDomains?: readonly string[];
  artifactCleanupIntervalMs?: number;
  artifactDir?: string;
  artifactMaxBytes?: number;
  artifactRetentionDays?: number;
  chatReplyAdapter?: ChatReplyAdapter;
  commandPrefix?: string;
  databasePath?: string;
  heartbeatIntervalMs?: number;
  logger?: FastifyServerOptions["logger"];
  now?: () => Date;
  productSearchAdapter?: ProductSearchAdapter;
  reaperIntervalMs?: number;
  retry?: RetryPolicy;
  trustedSenderIds?: readonly string[];
  version?: string;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
  });
  const database = openDatabase(options.databasePath ?? ":memory:");
  const agentRepository = new AgentRepository(database);
  const commandRepository = new CommandRepository(database);
  const taskRepository = new TaskRepository(database);
  const inboundMessageRepository = new InboundMessageRepository(database);
  const trustedSenderRepository = new TrustedSenderRepository(database);
  const commandPrefix = options.commandPrefix ?? "#助手";
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  for (const senderId of options.trustedSenderIds ?? []) {
    trustedSenderRepository.add(senderId, observedAt);
  }
  const retryPolicy = options.retry ?? new RetryPolicy();
  const aiQuestionWorkflow = new AiQuestionWorkflow({
    aiAdapter: options.aiAdapter ?? new UnavailableAiQuestionAdapter(),
    chatReplyAdapter: options.chatReplyAdapter ?? new UnavailableChatReplyAdapter(),
    inboundMessages: inboundMessageRepository,
    policy: new AiQuestionCommandPolicy({
      commandPrefix,
      isTrustedSender: (senderId) => trustedSenderRepository.isTrusted(senderId),
    }),
    retry: retryPolicy,
    tasks: taskRepository,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const productSearchWorkflow = new ProductSearchWorkflow({
    allowedDomains: new Set(options.allowedShoppingDomains ?? []),
    chatReplyAdapter: options.chatReplyAdapter ?? new UnavailableChatReplyAdapter(),
    productAdapter: options.productSearchAdapter ?? new UnavailableProductSearchAdapter(),
    retry: retryPolicy,
    tasks: taskRepository,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const assistantWorkflow = new AssistantWorkflow({
    aiPolicy: new AiQuestionCommandPolicy({
      commandPrefix,
      isTrustedSender: (senderId) => trustedSenderRepository.isTrusted(senderId),
    }),
    aiQuestionWorkflow,
    commandPrefix,
    inboundMessages: inboundMessageRepository,
    productSearchWorkflow,
    tasks: taskRepository,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const agentGateway = new AgentGateway(agentRepository, commandRepository, app.log, {
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 5_000,
    onChatMessage: async (message) => {
      await assistantWorkflow.handleMessage(message);
    },
    serverVersion: options.version ?? serviceVersion,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const taskReaper = new TaskReaper(taskRepository, assistantWorkflow, app.log, {
    intervalMs: options.reaperIntervalMs ?? 10_000,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const artifactCleanup = new ArtifactCleanupService({
    directory: options.artifactDir ?? "./data/artifacts",
    intervalMs: options.artifactCleanupIntervalMs ?? 3_600_000,
    ...(options.artifactMaxBytes === undefined ? {} : { maxTotalBytes: options.artifactMaxBytes }),
    ...(options.artifactRetentionDays === undefined
      ? {}
      : { maxAgeDays: options.artifactRetentionDays }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  app.decorate("agentGateway", agentGateway);
  app.decorate("aiQuestionWorkflow", aiQuestionWorkflow);
  app.decorate("artifactCleanup", artifactCleanup);
  app.decorate("assistantWorkflow", assistantWorkflow);
  app.decorate("productSearchWorkflow", productSearchWorkflow);
  app.decorate("taskReaper", taskReaper);

  app.addHook("onClose", () => {
    database.close();
  });

  await app.register(websocket);

  app.addHook("preClose", () => {
    taskReaper.close();
    artifactCleanup.close();
    agentGateway.close();
  });

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    () => ({
      status: "ok" as const,
      version: options.version ?? serviceVersion,
    }),
  );

  app.get(
    "/api/v1/agents",
    {
      schema: {
        response: {
          200: Type.Array(agentSchema),
        },
      },
    },
    () => agentRepository.list(),
  );

  app.get<{ Querystring: { state?: TaskState } }>(
    "/api/v1/tasks",
    {
      schema: {
        querystring: Type.Object(
          { state: Type.Optional(taskStateSchema) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Array(taskSchema),
        },
      },
    },
    (request) => assistantWorkflow.listTasks(request.query.state),
  );

  app.get<{ Params: { taskId: string } }>(
    "/api/v1/tasks/:taskId",
    {
      schema: {
        params: Type.Object(
          { taskId: Type.String({ format: "uuid" }) },
          { additionalProperties: false },
        ),
        response: {
          200: taskSchema,
          404: errorSchema,
        },
      },
    },
    (request, reply) => {
      const task = assistantWorkflow.getTask(request.params.taskId);
      if (task === undefined) {
        return reply.code(404).send({
          code: "TASK_NOT_FOUND",
          message: "Task was not found",
          requestId: randomUUID(),
        });
      }
      return task;
    },
  );

  app.post<{ Params: { taskId: string } }>(
    "/api/v1/tasks/:taskId/cancel",
    {
      schema: {
        params: Type.Object(
          { taskId: Type.String({ format: "uuid" }) },
          { additionalProperties: false },
        ),
        response: {
          202: taskSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    (request, reply) => {
      const result = assistantWorkflow.cancel(request.params.taskId);
      if (result === "NOT_FOUND") {
        return reply.code(404).send({
          code: "TASK_NOT_FOUND",
          message: "Task was not found",
          requestId: randomUUID(),
        });
      }
      if (result === "TERMINAL") {
        return reply.code(409).send({
          code: "TASK_TERMINAL",
          message: "Task is already terminal",
          requestId: randomUUID(),
        });
      }

      agentGateway.cancelTask(request.params.taskId);
      return reply.code(202).send(assistantWorkflow.getTask(request.params.taskId));
    },
  );

  app.post<{ Params: { taskId: string } }>(
    "/api/v1/tasks/:taskId/recover",
    {
      schema: {
        params: Type.Object(
          { taskId: Type.String({ format: "uuid" }) },
          { additionalProperties: false },
        ),
        response: {
          201: taskSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await assistantWorkflow.recoverTask(request.params.taskId);
      if (result.outcome === "REJECTED") {
        const status = result.code === "TASK_NOT_FOUND" ? 404 : 409;
        return reply.code(status).send({
          code: result.code,
          message: "Task could not be recovered",
          requestId: randomUUID(),
        });
      }

      return reply.code(201).send(assistantWorkflow.getTask(result.taskId));
    },
  );

  app.post(
    "/api/v1/system/emergency-stop",
    {
      schema: {
        response: {
          202: acceptedResponseSchema,
        },
      },
    },
    (_request, reply) => {
      const notifiedAgents = agentGateway.emergencyStop("Administrator emergency stop");
      return reply.code(202).send({ accepted: true, notifiedAgents });
    },
  );

  app.get("/ws/agent", { websocket: true }, (socket) => {
    agentGateway.attach(socket);
  });

  // Reconcile state left by a previous process before accepting new work. Reaper and
  // artifact cleanup use unref'ed timers and do not block process shutdown.
  taskReaper.recoverInterruptedTasks();
  taskReaper.start();
  artifactCleanup.start();
  await artifactCleanup.runOnce().catch((error: unknown) => {
    app.log.warn({ error: redactError(error) }, "Artifact cleanup failed during startup");
  });

  return app;
}

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
import { AgentGateway } from "./application/agent-gateway.js";
import { AiQuestionWorkflow } from "./application/ai-question-workflow.js";
import { AiQuestionCommandPolicy } from "./domain/ai-question-command.js";
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

const taskSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    shortCode: Type.String(),
    type: Type.Union([Type.Literal("AI_QUESTION"), Type.Literal("PRODUCT_SEARCH")]),
    state: taskStateSchema,
    request: Type.Unknown(),
    result: Type.Union([Type.Unknown(), Type.Null()]),
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
  chatReplyAdapter?: ChatReplyAdapter;
  commandPrefix?: string;
  databasePath?: string;
  heartbeatIntervalMs?: number;
  logger?: FastifyServerOptions["logger"];
  now?: () => Date;
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
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  for (const senderId of options.trustedSenderIds ?? []) {
    trustedSenderRepository.add(senderId, observedAt);
  }
  const aiQuestionWorkflow = new AiQuestionWorkflow({
    aiAdapter: options.aiAdapter ?? new UnavailableAiQuestionAdapter(),
    chatReplyAdapter: options.chatReplyAdapter ?? new UnavailableChatReplyAdapter(),
    inboundMessages: inboundMessageRepository,
    policy: new AiQuestionCommandPolicy({
      commandPrefix: options.commandPrefix ?? "#助手",
      isTrustedSender: (senderId) => trustedSenderRepository.isTrusted(senderId),
    }),
    tasks: taskRepository,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const agentGateway = new AgentGateway(agentRepository, commandRepository, app.log, {
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 5_000,
    onChatMessage: async (message) => {
      await aiQuestionWorkflow.handleMessage(message);
    },
    serverVersion: options.version ?? serviceVersion,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  app.decorate("agentGateway", agentGateway);
  app.decorate("aiQuestionWorkflow", aiQuestionWorkflow);

  app.addHook("onClose", () => {
    database.close();
  });

  await app.register(websocket);

  app.addHook("preClose", () => {
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
    (request) => aiQuestionWorkflow.listTasks(request.query.state),
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
      const task = aiQuestionWorkflow.getTask(request.params.taskId);
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
      const result = aiQuestionWorkflow.cancel(request.params.taskId);
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
      return reply.code(202).send(aiQuestionWorkflow.getTask(request.params.taskId));
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

  return app;
}

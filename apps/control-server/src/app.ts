import websocket from "@fastify/websocket";
import { AgentCapabilitySchema, AgentStatusSchema } from "@hos/contracts";
import { Type } from "@sinclair/typebox";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import { AgentGateway } from "./application/agent-gateway.js";
import { AgentRepository } from "./infrastructure/database/agent-repository.js";
import { CommandRepository } from "./infrastructure/database/command-repository.js";
import { openDatabase } from "./infrastructure/database/database.js";

declare module "fastify" {
  interface FastifyInstance {
    agentGateway: AgentGateway;
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

export interface BuildAppOptions {
  databasePath?: string;
  heartbeatIntervalMs?: number;
  logger?: FastifyServerOptions["logger"];
  now?: () => Date;
  version?: string;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
  });
  const database = openDatabase(options.databasePath ?? ":memory:");
  const agentRepository = new AgentRepository(database);
  const commandRepository = new CommandRepository(database);
  const agentGateway = new AgentGateway(agentRepository, commandRepository, app.log, {
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 5_000,
    serverVersion: options.version ?? serviceVersion,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  app.decorate("agentGateway", agentGateway);

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

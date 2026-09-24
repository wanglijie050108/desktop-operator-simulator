import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

const serviceVersion = "0.1.0";

const healthResponseSchema = Type.Object(
  {
    status: Type.Literal("ok"),
    version: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export interface BuildAppOptions {
  logger?: FastifyServerOptions["logger"];
  version?: string;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
  }).withTypeProvider<TypeBoxTypeProvider>();

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

  return app;
}

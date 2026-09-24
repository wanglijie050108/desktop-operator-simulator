import { buildApp } from "./app.js";
import { loadServerConfig } from "./config.js";

try {
  const config = loadServerConfig();
  const app = await buildApp({
    allowedShoppingDomains: config.allowedShoppingDomains,
    commandPrefix: config.commandPrefix,
    databasePath: config.databasePath,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    logger: true,
    trustedSenderIds: config.trustedSenderIds,
  });

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    app.log.info({ signal }, "Stopping control server");
    await app.close();
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : "Unknown startup error";
  console.error(
    JSON.stringify({
      level: "error",
      message: "Failed to start control server",
      error: errorMessage,
    }),
  );
  process.exitCode = 1;
}

import { buildApp } from "./app.js";
import { loadServerConfig } from "./config.js";

const app = buildApp({ logger: true });

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

try {
  const config = loadServerConfig();
  await app.listen(config);
} catch (error) {
  app.log.error(error, "Failed to start control server");
  process.exitCode = 1;
}

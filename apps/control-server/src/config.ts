const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7070;
const LOOPBACK_HOSTS = new Set([DEFAULT_HOST, "localhost", "::1"]);

export interface ServerConfig {
  databasePath: string;
  heartbeatIntervalMs: number;
  host: string;
  port: number;
}

export function loadServerConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = environment.SERVER_HOST ?? DEFAULT_HOST;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      "SERVER_HOST must resolve to the local machine until authentication is enabled",
    );
  }

  const rawPort = environment.SERVER_PORT;
  if (rawPort !== undefined && !/^[1-9]\d*$/.test(rawPort)) {
    throw new Error("SERVER_PORT must be an integer between 1 and 65535");
  }

  const port = rawPort === undefined ? DEFAULT_PORT : Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SERVER_PORT must be an integer between 1 and 65535");
  }

  const databasePath = environment.DATABASE_PATH ?? "./data/automation.db";
  if (databasePath.trim().length === 0) {
    throw new Error("DATABASE_PATH must not be empty");
  }

  const rawHeartbeatInterval = environment.AGENT_HEARTBEAT_INTERVAL_MS;
  if (rawHeartbeatInterval !== undefined && !/^[1-9]\d*$/.test(rawHeartbeatInterval)) {
    throw new Error("AGENT_HEARTBEAT_INTERVAL_MS must be between 1000 and 60000");
  }

  const heartbeatIntervalMs =
    rawHeartbeatInterval === undefined ? 5_000 : Number(rawHeartbeatInterval);
  if (
    !Number.isSafeInteger(heartbeatIntervalMs) ||
    heartbeatIntervalMs < 1_000 ||
    heartbeatIntervalMs > 60_000
  ) {
    throw new Error("AGENT_HEARTBEAT_INTERVAL_MS must be between 1000 and 60000");
  }

  return { databasePath, heartbeatIntervalMs, host, port };
}

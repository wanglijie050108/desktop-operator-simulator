const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7070;
const LOOPBACK_HOSTS = new Set([DEFAULT_HOST, "localhost", "::1"]);

export interface ServerConfig {
  allowedShoppingDomains: string[];
  commandPrefix: string;
  databasePath: string;
  heartbeatIntervalMs: number;
  host: string;
  port: number;
  trustedSenderIds: string[];
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

  const commandPrefix = environment.COMMAND_PREFIX ?? "#助手";
  if (commandPrefix.trim().length === 0 || commandPrefix.length > 50) {
    throw new Error("COMMAND_PREFIX must contain between 1 and 50 characters");
  }

  const trustedSenderIds = (environment.TRUSTED_SENDER_IDS ?? "")
    .split(",")
    .map((senderId) => senderId.trim())
    .filter((senderId) => senderId.length > 0);
  if (trustedSenderIds.some((senderId) => senderId.length > 200)) {
    throw new Error("TRUSTED_SENDER_IDS entries must not exceed 200 characters");
  }

  const allowedShoppingDomains = (environment.ALLOWED_SHOPPING_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);
  if (
    allowedShoppingDomains.some(
      (domain) =>
        domain.length > 253 ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
          domain,
        ),
    )
  ) {
    throw new Error("ALLOWED_SHOPPING_DOMAINS must contain comma-separated hostnames");
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

  return {
    allowedShoppingDomains: [...new Set(allowedShoppingDomains)],
    commandPrefix,
    databasePath,
    heartbeatIntervalMs,
    host,
    port,
    trustedSenderIds: [...new Set(trustedSenderIds)],
  };
}

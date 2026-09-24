const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7070;
const LOOPBACK_HOSTS = new Set([DEFAULT_HOST, "localhost", "::1"]);

export interface ServerConfig {
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

  return { host, port };
}

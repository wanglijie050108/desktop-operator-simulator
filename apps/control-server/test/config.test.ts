import { describe, expect, it } from "vitest";

import { loadServerConfig } from "../src/config.js";

describe("server configuration", () => {
  it("uses loopback defaults", () => {
    expect(loadServerConfig({})).toStrictEqual({
      commandPrefix: "#助手",
      databasePath: "./data/automation.db",
      heartbeatIntervalMs: 5_000,
      host: "127.0.0.1",
      port: 7070,
      trustedSenderIds: [],
    });
  });

  it.each(["127.0.0.1", "localhost", "::1"])("allows loopback host %s", (host) => {
    expect(loadServerConfig({ SERVER_HOST: host }).host).toBe(host);
  });

  it.each(["0.0.0.0", "192.168.1.20", "control-server.local"])(
    "rejects non-loopback host %s",
    (host) => {
      expect(() => loadServerConfig({ SERVER_HOST: host })).toThrow(
        "SERVER_HOST must resolve to the local machine until authentication is enabled",
      );
    },
  );

  it.each(["", "0", "-1", "1.5", "1e3", "65536", "not-a-port"])(
    "rejects invalid port %s",
    (port) => {
      expect(() => loadServerConfig({ SERVER_PORT: port })).toThrow(
        "SERVER_PORT must be an integer between 1 and 65535",
      );
    },
  );

  it.each([
    ["1", 1],
    ["7071", 7071],
    ["65535", 65_535],
  ])("parses valid port %s", (rawPort, expectedPort) => {
    expect(loadServerConfig({ SERVER_PORT: rawPort }).port).toBe(expectedPort);
  });

  it("accepts database and heartbeat overrides", () => {
    expect(
      loadServerConfig({
        AGENT_HEARTBEAT_INTERVAL_MS: "10000",
        DATABASE_PATH: "./data/test.db",
      }),
    ).toMatchObject({
      databasePath: "./data/test.db",
      heartbeatIntervalMs: 10_000,
    });
  });

  it("parses command policy configuration", () => {
    expect(
      loadServerConfig({
        COMMAND_PREFIX: "#bot",
        TRUSTED_SENDER_IDS: "sender-a, sender-b,sender-a",
      }),
    ).toMatchObject({
      commandPrefix: "#bot",
      trustedSenderIds: ["sender-a", "sender-b"],
    });
  });

  it.each([
    { COMMAND_PREFIX: "" },
    { COMMAND_PREFIX: " " },
    { COMMAND_PREFIX: "x".repeat(51) },
    { TRUSTED_SENDER_IDS: "x".repeat(201) },
  ])("rejects invalid command policy configuration", (environment) => {
    expect(() => loadServerConfig(environment)).toThrow();
  });

  it("rejects an empty database path", () => {
    expect(() => loadServerConfig({ DATABASE_PATH: " " })).toThrow(
      "DATABASE_PATH must not be empty",
    );
  });

  it.each(["", "999", "1e3", "60001", "invalid"])(
    "rejects invalid heartbeat interval %s",
    (interval) => {
      expect(() => loadServerConfig({ AGENT_HEARTBEAT_INTERVAL_MS: interval })).toThrow(
        "AGENT_HEARTBEAT_INTERVAL_MS must be between 1000 and 60000",
      );
    },
  );
});

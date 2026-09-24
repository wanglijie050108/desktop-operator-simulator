import { describe, expect, it } from "vitest";

import { loadServerConfig } from "../src/config.js";

describe("server configuration", () => {
  it("uses loopback defaults", () => {
    expect(loadServerConfig({})).toStrictEqual({
      host: "127.0.0.1",
      port: 7070,
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
});

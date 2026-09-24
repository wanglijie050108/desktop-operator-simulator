import type { AddressInfo } from "node:net";

import type {
  AgentHeartbeat,
  AgentHello,
  DesktopCommand,
  DesktopCommandResult,
  ServerToAgentMessage,
} from "@hos/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { buildApp } from "../src/app.js";

const openApps: FastifyInstance[] = [];
const openSockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) {
    socket.terminate();
  }
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForMessage(socket: WebSocket): Promise<ServerToAgentMessage> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        const text = Array.isArray(data)
          ? Buffer.concat(data).toString("utf8")
          : data instanceof ArrayBuffer
            ? Buffer.from(data).toString("utf8")
            : data.toString("utf8");
        resolve(JSON.parse(text) as ServerToAgentMessage);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Invalid JSON message"));
      }
    });
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once("close", resolve);
  });
}

async function waitForAgentStatus(app: FastifyInstance, expectedStatus: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.inject({ method: "GET", url: "/api/v1/agents" });
    const agents = response.json<{ status: string }[]>();
    if (agents[0]?.status === expectedStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Agent did not reach status ${expectedStatus}`);
}

async function startServer(now?: () => Date): Promise<{ app: FastifyInstance; url: string }> {
  const app = await buildApp({
    heartbeatIntervalMs: 1_000,
    ...(now === undefined ? {} : { now }),
    version: "1.2.3-test",
  });
  openApps.push(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  return { app, url: `ws://127.0.0.1:${String(address.port)}/ws/agent` };
}

function helloMessage(): AgentHello {
  return {
    schemaVersion: "1.0",
    type: "agent.hello",
    messageId: "11111111-1111-4111-8111-111111111111",
    timestamp: "2026-09-24T04:00:00Z",
    payload: {
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "fake-agent",
      version: "0.1.0",
      capabilities: ["wechat.read"],
    },
  };
}

async function register(socket: WebSocket): Promise<ServerToAgentMessage> {
  const welcome = waitForMessage(socket);
  socket.send(JSON.stringify(helloMessage()));
  return welcome;
}

describe("Agent WebSocket gateway", () => {
  it("registers, tracks heartbeat, broadcasts emergency stop, and marks offline", async () => {
    const { app, url } = await startServer();
    const socket = new WebSocket(url);
    openSockets.push(socket);
    await waitForOpen(socket);

    await expect(register(socket)).resolves.toMatchObject({
      type: "server.welcome",
      payload: {
        heartbeatIntervalMs: 1_000,
        serverVersion: "1.2.3-test",
      },
    });

    const heartbeat: AgentHeartbeat = {
      schemaVersion: "1.0",
      type: "agent.heartbeat",
      messageId: "22222222-2222-4222-8222-222222222222",
      timestamp: "2026-09-24T04:00:05Z",
      payload: {
        agentId: helloMessage().payload.agentId,
        status: "BUSY",
      },
    };
    socket.send(JSON.stringify(heartbeat));
    await waitForAgentStatus(app, "BUSY");

    const emergencyMessage = waitForMessage(socket);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/system/emergency-stop",
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toStrictEqual({ accepted: true, notifiedAgents: 1 });
    await expect(emergencyMessage).resolves.toMatchObject({
      type: "system.emergency-stop",
    });

    const closed = waitForClose(socket);
    socket.close();
    await closed;
    await waitForAgentStatus(app, "OFFLINE");
  });

  it("rejects a heartbeat before registration", async () => {
    const { url } = await startServer();
    const socket = new WebSocket(url);
    openSockets.push(socket);
    await waitForOpen(socket);

    const heartbeat: AgentHeartbeat = {
      schemaVersion: "1.0",
      type: "agent.heartbeat",
      messageId: "22222222-2222-4222-8222-222222222222",
      timestamp: "2026-09-24T04:00:05Z",
      payload: {
        agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "ONLINE",
      },
    };
    const errorMessage = waitForMessage(socket);
    const closed = waitForClose(socket);
    socket.send(JSON.stringify(heartbeat));

    await expect(errorMessage).resolves.toMatchObject({
      type: "server.error",
      payload: { code: "AGENT_NOT_REGISTERED" },
    });
    await expect(closed).resolves.toBe(1008);
  });

  it("sends commands, records results, and broadcasts task cancellation", async () => {
    const { app, url } = await startServer();
    const socket = new WebSocket(url);
    openSockets.push(socket);
    await waitForOpen(socket);
    await register(socket);

    const command: DesktopCommand = {
      schemaVersion: "1.0",
      type: "desktop.command",
      messageId: "44444444-4444-4444-8444-444444444444",
      timestamp: "2026-09-24T04:01:00Z",
      payload: {
        commandId: "55555555-5555-4555-8555-555555555555",
        taskId: "66666666-6666-4666-8666-666666666666",
        expiresAt: "2026-09-24T04:01:30Z",
        action: "WECHAT_READ_NEW_MESSAGES",
        arguments: {},
      },
    };
    const receivedCommand = waitForMessage(socket);
    expect(app.agentGateway.sendCommand(helloMessage().payload.agentId, command)).toBe(true);
    await expect(receivedCommand).resolves.toStrictEqual(command);
    expect(app.agentGateway.sendCommand("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", command)).toBe(
      false,
    );

    const result: DesktopCommandResult = {
      schemaVersion: "1.0",
      type: "desktop.command.result",
      messageId: "77777777-7777-4777-8777-777777777777",
      timestamp: "2026-09-24T04:01:01Z",
      payload: {
        commandId: command.payload.commandId,
        taskId: command.payload.taskId,
        outcome: "FAILED",
        errorCode: "NOT_IMPLEMENTED",
      },
    };
    socket.send(JSON.stringify(result));

    const cancellation = waitForMessage(socket);
    expect(app.agentGateway.cancelTask(command.payload.taskId)).toBe(1);
    await expect(cancellation).resolves.toMatchObject({
      type: "task.cancel",
      payload: { taskId: command.payload.taskId },
    });
  });

  it.each([
    ["not-json", "INVALID_MESSAGE"],
    [
      JSON.stringify({
        ...helloMessage(),
        schemaVersion: "2.0",
      }),
      "INVALID_MESSAGE",
    ],
  ])("rejects malformed input", async (input, expectedCode) => {
    const { url } = await startServer();
    const socket = new WebSocket(url);
    openSockets.push(socket);
    await waitForOpen(socket);

    const errorMessage = waitForMessage(socket);
    socket.send(input);

    await expect(errorMessage).resolves.toMatchObject({
      type: "server.error",
      payload: { code: expectedCode },
    });
  });

  it("rejects a different agent identity after registration", async () => {
    const { url } = await startServer();
    const socket = new WebSocket(url);
    openSockets.push(socket);
    await waitForOpen(socket);
    await register(socket);

    const errorMessage = waitForMessage(socket);
    socket.send(
      JSON.stringify({
        schemaVersion: "1.0",
        type: "agent.heartbeat",
        messageId: "22222222-2222-4222-8222-222222222222",
        timestamp: "2026-09-24T04:00:05Z",
        payload: {
          agentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          status: "ONLINE",
        },
      }),
    );

    await expect(errorMessage).resolves.toMatchObject({
      type: "server.error",
      payload: { code: "AGENT_ID_MISMATCH" },
    });
  });

  it("replaces an existing connection for the same agent", async () => {
    const { url } = await startServer();
    const first = new WebSocket(url);
    const second = new WebSocket(url);
    openSockets.push(first, second);
    await Promise.all([waitForOpen(first), waitForOpen(second)]);
    await register(first);

    const firstClosed = waitForClose(first);
    await register(second);

    await expect(firstClosed).resolves.toBe(1012);
  });

  it("disconnects an agent after three missed heartbeat intervals", async () => {
    let now = new Date("2026-09-24T04:00:00.000Z");
    const { app, url } = await startServer(() => now);
    const socket = new WebSocket(url);
    openSockets.push(socket);
    await waitForOpen(socket);
    await register(socket);

    now = new Date("2026-09-24T04:00:03.001Z");
    const closed = waitForClose(socket);
    expect(app.agentGateway.disconnectStaleSessions()).toBe(1);

    await expect(closed).resolves.toBe(1001);
    await waitForAgentStatus(app, "OFFLINE");
    expect(app.agentGateway.disconnectStaleSessions()).toBe(0);
  });
});

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  AgentHeartbeatSchema,
  AgentHelloSchema,
  ChatMessageReceivedSchema,
  DesktopCommandResultSchema,
  DesktopCommandSchema,
  EmergencyStopSchema,
  isSchemaValue,
  ProtocolErrorSchema,
  ServerWelcomeSchema,
  TaskCancelSchema,
} from "../src/index.js";

const schemasByType = {
  "agent.heartbeat": AgentHeartbeatSchema,
  "agent.hello": AgentHelloSchema,
  "chat.message.received": ChatMessageReceivedSchema,
  "desktop.command": DesktopCommandSchema,
  "desktop.command.result": DesktopCommandResultSchema,
  "server.error": ProtocolErrorSchema,
  "server.welcome": ServerWelcomeSchema,
  "system.emergency-stop": EmergencyStopSchema,
  "task.cancel": TaskCancelSchema,
} as const;

async function loadFixtures(): Promise<unknown[]> {
  const fixtureUrl = new URL(
    "../../../contracts/fixtures/websocket-v1/messages.json",
    import.meta.url,
  );
  return JSON.parse(await readFile(fixtureUrl, "utf8")) as unknown[];
}

function desktopCommand(action: string, args: unknown): unknown {
  return {
    schemaVersion: "1.0",
    type: "desktop.command",
    messageId: "44444444-4444-4444-8444-444444444444",
    timestamp: "2026-09-24T04:01:00Z",
    payload: {
      commandId: "55555555-5555-4555-8555-555555555555",
      taskId: "66666666-6666-4666-8666-666666666666",
      expiresAt: "2026-09-24T04:01:30Z",
      action,
      arguments: args,
    },
  };
}

describe("WebSocket v1 contracts", () => {
  it("accepts every cross-language fixture", async () => {
    const fixtures = await loadFixtures();

    for (const fixture of fixtures) {
      expect(fixture).toHaveProperty("type");
      const type = (fixture as { type: keyof typeof schemasByType }).type;
      expect(isSchemaValue(schemasByType[type], fixture)).toBe(true);
    }
  });

  it("rejects unknown properties at the trust boundary", () => {
    const invalid = {
      schemaVersion: "1.0",
      type: "agent.hello",
      messageId: "11111111-1111-4111-8111-111111111111",
      timestamp: "2026-09-24T04:00:00Z",
      payload: {
        agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "fixture-agent",
        version: "0.1.0",
        capabilities: [],
        arbitraryScript: "not allowed",
      },
    };

    expect(isSchemaValue(AgentHelloSchema, invalid)).toBe(false);
  });

  it("rejects unsupported schema versions", () => {
    const invalid = {
      schemaVersion: "2.0",
      type: "agent.heartbeat",
      messageId: "22222222-2222-4222-8222-222222222222",
      timestamp: "2026-09-24T04:00:05Z",
      payload: {
        agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "ONLINE",
      },
    };

    expect(isSchemaValue(AgentHeartbeatSchema, invalid)).toBe(false);
  });

  it("accepts both interoperable UTC timestamp representations", () => {
    const heartbeat = {
      schemaVersion: "1.0",
      type: "agent.heartbeat",
      messageId: "22222222-2222-4222-8222-222222222222",
      timestamp: "2026-09-24T04:00:05+00:00",
      payload: {
        agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "ONLINE",
      },
    };

    expect(isSchemaValue(AgentHeartbeatSchema, heartbeat)).toBe(true);
    expect(
      isSchemaValue(AgentHeartbeatSchema, {
        ...heartbeat,
        timestamp: "2026-09-24T12:00:05+08:00",
      }),
    ).toBe(false);
  });

  it("validates a strict inbound chat message", () => {
    const message = {
      schemaVersion: "1.0",
      type: "chat.message.received",
      messageId: "33333333-3333-4333-8333-333333333333",
      timestamp: "2026-09-24T04:00:06Z",
      payload: {
        source: "WECHAT",
        externalMessageId: "source-message-id",
        conversationId: "conversation-hash",
        senderId: "sender-hash",
        content: "#助手 问AI：解释零信任网络",
        receivedAt: "2026-09-24T04:00:05Z",
      },
    };

    expect(isSchemaValue(ChatMessageReceivedSchema, message)).toBe(true);
    expect(
      isSchemaValue(ChatMessageReceivedSchema, {
        ...message,
        payload: { ...message.payload, arbitraryAction: "SHELL_EXEC" },
      }),
    ).toBe(false);
  });

  it("accepts every mouse action with semantic locators", () => {
    const document = { processName: "notepad.exe", controlType: "Document" };
    const accepted = [
      desktopCommand("MOUSE_MOVE", { target: document }),
      desktopCommand("MOUSE_MOVE", { target: { ...document, offsetX: 4, offsetY: 8 } }),
      desktopCommand("MOUSE_CLICK", { target: document, button: "RIGHT", clickCount: 2 }),
      desktopCommand("MOUSE_CLICK", { target: { processName: "notepad.exe" } }),
      desktopCommand("MOUSE_DRAG", {
        from: { processName: "notepad.exe", automationId: "Source" },
        to: { processName: "notepad.exe", name: "Target", index: 1 },
      }),
      desktopCommand("MOUSE_SCROLL", { target: document, verticalDelta: -3 }),
      desktopCommand("MOUSE_SCROLL", { target: document, verticalDelta: 20 }),
      desktopCommand("MOUSE_CLICK_POSITION", {
        target: { processName: "notepad.exe" },
        x: 0,
        y: 20_000,
        button: "MIDDLE",
      }),
    ];

    for (const command of accepted) {
      expect(isSchemaValue(DesktopCommandSchema, command)).toBe(true);
    }
  });

  it("rejects out-of-contract mouse arguments", () => {
    const document = { processName: "notepad.exe", controlType: "Document" };
    const rejected = [
      // A locator without a process name cannot be resolved to an allowlisted window.
      desktopCommand("MOUSE_CLICK", { target: { controlType: "Document" } }),
      // Absolute screen coordinates are not part of the semantic locator contract.
      desktopCommand("MOUSE_CLICK", { target: document, screenX: 10, screenY: 20 }),
      desktopCommand("MOUSE_CLICK", { target: document, clickCount: 3 }),
      desktopCommand("MOUSE_CLICK", { target: document, button: "SIDE" }),
      desktopCommand("MOUSE_CLICK", { target: { ...document, index: 100 } }),
      desktopCommand("MOUSE_CLICK", { target: { ...document, offsetX: 2_001 } }),
      desktopCommand("MOUSE_MOVE", { target: { ...document, script: "not allowed" } }),
      // A zero-tick wheel action is a no-op and must be rejected instead of sent.
      desktopCommand("MOUSE_SCROLL", { target: document, verticalDelta: 0 }),
      desktopCommand("MOUSE_SCROLL", { target: document, verticalDelta: 21 }),
      desktopCommand("MOUSE_DRAG", { from: document }),
      desktopCommand("MOUSE_CLICK_POSITION", {
        target: { processName: "notepad.exe" },
        x: -1,
        y: 10,
      }),
      desktopCommand("MOUSE_CLICK_POSITION", {
        target: { processName: "notepad.exe" },
        x: 10,
        y: 10,
        titleContains: "Notepad",
      }),
    ];

    for (const command of rejected) {
      expect(isSchemaValue(DesktopCommandSchema, command)).toBe(false);
    }
  });

  it("declares mouse as an agent capability", () => {
    const hello = {
      schemaVersion: "1.0",
      type: "agent.hello",
      messageId: "11111111-1111-4111-8111-111111111111",
      timestamp: "2026-09-24T04:00:00Z",
      payload: {
        agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "fixture-agent",
        version: "0.1.0",
        capabilities: ["input", "mouse", "clipboard"],
      },
    };

    expect(isSchemaValue(AgentHelloSchema, hello)).toBe(true);
    expect(
      isSchemaValue(AgentHelloSchema, {
        ...hello,
        payload: { ...hello.payload, capabilities: ["pointer"] },
      }),
    ).toBe(false);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentHello, DesktopCommand, DesktopCommandResult } from "@hos/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRepository } from "../src/infrastructure/database/agent-repository.js";
import { CommandRepository } from "../src/infrastructure/database/command-repository.js";
import { openDatabase, type DatabaseContext } from "../src/infrastructure/database/database.js";
import {
  confirmations,
  desktopCommands,
  inboundMessages,
  schemaMigrations,
  taskSteps,
  tasks,
} from "../src/infrastructure/database/schema.js";

const contexts: DatabaseContext[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    context.close();
  }
  await Promise.all(
    directories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

function helloMessage(): AgentHello {
  return {
    schemaVersion: "1.0",
    type: "agent.hello",
    messageId: "11111111-1111-4111-8111-111111111111",
    timestamp: "2026-09-24T04:00:00Z",
    payload: {
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "test-agent",
      version: "0.1.0",
      capabilities: ["wechat.read", "wechat.send"],
    },
  };
}

describe("SQLite infrastructure", () => {
  it("applies migrations idempotently to a persistent database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hos-db-"));
    directories.push(directory);
    const databasePath = join(directory, "automation.db");

    const first = openDatabase(databasePath);
    expect(first.db.select().from(schemaMigrations).all()).toHaveLength(2);
    expect(first.db.select().from(inboundMessages).all()).toStrictEqual([]);
    expect(first.db.select().from(tasks).all()).toStrictEqual([]);
    expect(first.db.select().from(taskSteps).all()).toStrictEqual([]);
    expect(first.db.select().from(confirmations).all()).toStrictEqual([]);
    first.close();

    const second = openDatabase(databasePath);
    contexts.push(second);
    expect(second.db.select().from(schemaMigrations).all()).toHaveLength(2);
  });

  it("registers, updates, lists, and disconnects an agent", () => {
    const context = openDatabase(":memory:");
    contexts.push(context);
    const repository = new AgentRepository(context);

    repository.register(helloMessage(), "2026-09-24T04:00:01.000Z");
    expect(
      repository.heartbeat(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "BUSY",
        "2026-09-24T04:00:02.000Z",
      ),
    ).toBe(true);
    expect(
      repository.heartbeat(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "ONLINE",
        "2026-09-24T04:00:02.000Z",
      ),
    ).toBe(false);

    expect(repository.list()).toStrictEqual([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "test-agent",
        status: "BUSY",
        capabilities: ["wechat.read", "wechat.send"],
        lastSeenAt: "2026-09-24T04:00:02.000Z",
        version: "0.1.0",
      },
    ]);

    repository.markOffline("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-09-24T04:00:03.000Z");
    expect(repository.list()[0]?.status).toBe("OFFLINE");
  });

  it("persists command lifecycle idempotently", () => {
    const context = openDatabase(":memory:");
    contexts.push(context);
    const repository = new CommandRepository(context);
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

    repository.create(command, command.timestamp);
    repository.create(command, command.timestamp);
    expect(repository.complete(result, result.timestamp)).toBe(true);
    expect(repository.complete(result, result.timestamp)).toBe(false);

    expect(context.db.select().from(desktopCommands).all()).toStrictEqual([
      expect.objectContaining({
        commandId: command.payload.commandId,
        state: "FAILED",
        errorCode: "NOT_IMPLEMENTED",
      }),
    ]);
  });

  it("cancels pending commands by task or globally", () => {
    const context = openDatabase(":memory:");
    contexts.push(context);
    const repository = new CommandRepository(context);
    const first = commandMessage(
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    );
    const second = commandMessage(
      "77777777-7777-4777-8777-777777777777",
      "88888888-8888-4888-8888-888888888888",
    );
    repository.create(first, first.timestamp);
    repository.create(second, second.timestamp);

    expect(repository.cancelTask(first.payload.taskId, "2026-09-24T04:01:02Z")).toBe(1);
    expect(repository.cancelAll("2026-09-24T04:01:03Z")).toBe(1);
    expect(
      context.db
        .select()
        .from(desktopCommands)
        .all()
        .map((row) => row.state),
    ).toStrictEqual(["CANCELLED", "CANCELLED"]);
  });
});

function commandMessage(commandId: string, taskId: string): DesktopCommand {
  return {
    schemaVersion: "1.0",
    type: "desktop.command",
    messageId: crypto.randomUUID(),
    timestamp: "2026-09-24T04:01:00Z",
    payload: {
      commandId,
      taskId,
      expiresAt: "2026-09-24T04:01:30Z",
      action: "WECHAT_READ_NEW_MESSAGES",
      arguments: {},
    },
  };
}

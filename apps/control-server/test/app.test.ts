import { randomUUID } from "node:crypto";

import type { ChatMessageReceived } from "@hos/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdapterError } from "../src/adapters/adapter-error.js";
import { buildApp } from "../src/app.js";
import type { TaskStatisticsReport } from "../src/domain/task-statistics.js";
import type { TaskRecord } from "../src/infrastructure/database/task-repository.js";

function aiMessage(externalMessageId: string): ChatMessageReceived {
  return {
    messageId: randomUUID(),
    payload: {
      conversationId: "conv",
      content: "#助手 问AI：解释超时",
      externalMessageId,
      receivedAt: "2026-09-24T11:59:00.000Z",
      senderId: "trusted-sender",
      source: "WECHAT",
    },
    schemaVersion: "1.0",
    timestamp: "2026-09-24T11:59:00.000Z",
    type: "chat.message.received",
  };
}

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

describe("control server", () => {
  it("returns the contract health response", async () => {
    const app = await buildApp({ version: "1.2.3-test" });
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.json()).toStrictEqual({
      status: "ok",
      version: "1.2.3-test",
    });
  });

  it("reports the package service version by default", async () => {
    const app = await buildApp();
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.json()).toStrictEqual({
      status: "ok",
      version: "0.1.0",
    });
  });

  it("does not expose undeclared routes", async () => {
    const app = await buildApp();
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/not-implemented",
    });

    expect(response.statusCode).toBe(404);
  });

  it("accepts an emergency stop with no connected agents", async () => {
    const app = await buildApp();
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/system/emergency-stop",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toStrictEqual({
      accepted: true,
      notifiedAgents: 0,
    });
  });

  it("creates a fresh task when recovering a failed task", async () => {
    const ask = vi
      .fn()
      .mockRejectedValueOnce(new AdapterError("AI_PAGE_UNAVAILABLE", "fixture offline"))
      .mockResolvedValueOnce({
        answer: "恢复后的答案",
        durationMs: 10,
        source: "fixture",
      });
    const app = await buildApp({
      aiAdapter: { ask },
      chatReplyAdapter: { send: () => Promise.resolve() },
      trustedSenderIds: ["trusted-sender"],
    });
    openApps.push(app);

    await app.aiQuestionWorkflow.handleMessage(aiMessage("failed-message"));
    const failedId = app.aiQuestionWorkflow.listTasks("FAILED")[0]?.id;
    expect(failedId).toBeDefined();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${String(failedId)}/recover`,
    });

    expect(response.statusCode).toBe(201);
    const recovered = response.json<TaskRecord>();
    expect(recovered.id).not.toBe(failedId);
    expect(recovered).toMatchObject({
      request: { question: "解释超时" },
      state: "SUCCEEDED",
    });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("returns 404 when recovering an unknown task", async () => {
    const app = await buildApp();
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/99999999-9999-4999-8999-999999999999/recover",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "TASK_NOT_FOUND" });
  });

  it("returns zeroed statistics with null success rate on an empty server", async () => {
    const app = await buildApp({ version: "7.7.7" });
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/statistics",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<TaskStatisticsReport>();
    expect(body.version).toBe("7.7.7");
    expect(() => new Date(body.generatedAt)).not.toThrow();
    expect(body.overall).toMatchObject({
      completedCount: 0,
      failedCount: 0,
      succeededCount: 0,
      successRate: null,
      terminalCount: 0,
      totalCount: 0,
    });
    expect(body.byType.AI_QUESTION.totalCount).toBe(0);
    expect(body.byType.PRODUCT_SEARCH.totalCount).toBe(0);
  });

  it("aggregates task outcomes and error codes in the statistics report", async () => {
    const ask = vi
      .fn()
      .mockRejectedValueOnce(new AdapterError("AI_PAGE_UNAVAILABLE", "fixture offline"))
      .mockResolvedValueOnce({
        answer: "正常答案",
        durationMs: 10,
        source: "fixture",
      });
    const app = await buildApp({
      aiAdapter: { ask },
      chatReplyAdapter: { send: () => Promise.resolve() },
      now: () => new Date("2026-09-24T12:00:00.000Z"),
      trustedSenderIds: ["trusted-sender"],
    });
    openApps.push(app);

    await app.aiQuestionWorkflow.handleMessage(aiMessage("stats-failed"));
    await app.aiQuestionWorkflow.handleMessage(aiMessage("stats-succeeded"));

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/statistics",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<TaskStatisticsReport>();
    expect(body.overall).toMatchObject({
      completedCount: 2,
      failedCount: 1,
      succeededCount: 1,
      successRate: 0.5,
      terminalCount: 2,
      totalCount: 2,
    });
    expect(body.overall.duration.count).toBe(2);
    expect(body.overall.errorDistribution).toStrictEqual([
      { code: "AI_PAGE_UNAVAILABLE", count: 1 },
    ]);
    expect(body.byType.AI_QUESTION.totalCount).toBe(2);
    expect(body.byType.PRODUCT_SEARCH.totalCount).toBe(0);
  });

  it("filters statistics by type and inclusive time window", async () => {
    const ask = vi.fn().mockResolvedValue({
      answer: "正常答案",
      durationMs: 10,
      source: "fixture",
    });
    const app = await buildApp({
      aiAdapter: { ask },
      chatReplyAdapter: { send: () => Promise.resolve() },
      now: () => new Date("2026-09-24T12:00:00.000Z"),
      trustedSenderIds: ["trusted-sender"],
    });
    openApps.push(app);

    await app.aiQuestionWorkflow.handleMessage(aiMessage("stats-filter"));

    const byOtherType = await app.inject({
      method: "GET",
      url: "/api/v1/statistics?type=PRODUCT_SEARCH",
    });
    expect(byOtherType.statusCode).toBe(200);
    expect(byOtherType.json<TaskStatisticsReport>().overall.totalCount).toBe(0);

    const insideWindow = await app.inject({
      method: "GET",
      url: "/api/v1/statistics?from=2026-09-24T11:00:00.000Z&to=2026-09-24T12:00:00.000Z",
    });
    expect(insideWindow.json<TaskStatisticsReport>().overall.totalCount).toBe(1);

    const afterWindow = await app.inject({
      method: "GET",
      url: "/api/v1/statistics?from=2026-09-24T13:00:00.000Z",
    });
    expect(afterWindow.json<TaskStatisticsReport>().overall.totalCount).toBe(0);
  });

  it("rejects statistics queries with malformed time boundaries", async () => {
    const app = await buildApp();
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/statistics?from=not-a-date",
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 409 when recovering a non-recoverable task", async () => {
    const app = await buildApp({
      aiAdapter: {
        ask: () => Promise.resolve({ answer: "答案", durationMs: 10, source: "fixture" }),
      },
      chatReplyAdapter: { send: () => Promise.resolve() },
      trustedSenderIds: ["trusted-sender"],
    });
    openApps.push(app);

    await app.aiQuestionWorkflow.handleMessage(aiMessage("succeeded-message"));
    const succeededId = app.aiQuestionWorkflow.listTasks("SUCCEEDED")[0]?.id;
    expect(succeededId).toBeDefined();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${String(succeededId)}/recover`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "TASK_NOT_RECOVERABLE" });
  });
});

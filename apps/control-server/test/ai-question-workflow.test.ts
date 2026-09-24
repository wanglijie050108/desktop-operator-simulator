import { randomUUID } from "node:crypto";

import type { ChatMessageReceived } from "@hos/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdapterError,
  type AiQuestionAdapter,
  type AiQuestionRequest,
  type AiQuestionResult,
} from "../src/adapters/ai-question-adapter.js";
import type { ChatReplyAdapter, ChatReplyRequest } from "../src/adapters/chat-reply-adapter.js";
import { buildApp } from "../src/app.js";
import { RetryPolicy } from "../src/domain/retry-policy.js";
import type { TaskRecord } from "../src/infrastructure/database/task-repository.js";

class FakeAiAdapter implements AiQuestionAdapter {
  public readonly requests: AiQuestionRequest[] = [];

  public constructor(
    private readonly response: AiQuestionResult = {
      answer: "零信任要求持续验证每次访问。",
      durationMs: 25,
      source: "fake-ai-fixture",
    },
  ) {}

  public ask(request: AiQuestionRequest): Promise<AiQuestionResult> {
    this.requests.push(request);
    return Promise.resolve(this.response);
  }
}

class FakeChatReplyAdapter implements ChatReplyAdapter {
  public readonly requests: ChatReplyRequest[] = [];

  public send(request: ChatReplyRequest): Promise<void> {
    this.requests.push(request);
    return Promise.resolve();
  }
}

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

function message(
  externalMessageId: string,
  overrides: Partial<ChatMessageReceived["payload"]> = {},
): ChatMessageReceived {
  return {
    schemaVersion: "1.0",
    type: "chat.message.received",
    messageId: randomUUID(),
    timestamp: "2026-09-24T04:00:00Z",
    payload: {
      source: "WECHAT",
      externalMessageId,
      conversationId: "conversation-hash",
      senderId: "trusted-sender",
      content: "#助手 问AI：解释零信任网络",
      receivedAt: "2026-09-24T04:00:00Z",
      ...overrides,
    },
  };
}

async function createTestApp(
  aiAdapter: AiQuestionAdapter = new FakeAiAdapter(),
  chatReplyAdapter: ChatReplyAdapter = new FakeChatReplyAdapter(),
): Promise<FastifyInstance> {
  const app = await buildApp({
    aiAdapter,
    chatReplyAdapter,
    trustedSenderIds: ["trusted-sender"],
  });
  openApps.push(app);
  return app;
}

describe("AI question workflow", () => {
  it("persists a successful task and its deterministic steps", async () => {
    const aiAdapter = new FakeAiAdapter();
    const chatAdapter = new FakeChatReplyAdapter();
    const app = await createTestApp(aiAdapter, chatAdapter);

    const handled = await app.aiQuestionWorkflow.handleMessage(message("message-1"));
    expect(handled.outcome).toBe("TASK_CREATED");

    const response = await app.inject({ method: "GET", url: "/api/v1/tasks" });
    expect(response.statusCode).toBe(200);
    const tasks = response.json<TaskRecord[]>();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.type).toBe("AI_QUESTION");
    expect(tasks[0]?.state).toBe("SUCCEEDED");
    expect(tasks[0]?.request).toStrictEqual({
      conversationId: "conversation-hash",
      question: "解释零信任网络",
      source: "WECHAT",
    });
    expect(tasks[0]?.result).toStrictEqual({
      answer: "零信任要求持续验证每次访问。",
      durationMs: 25,
      source: "fake-ai-fixture",
    });
    expect(
      tasks[0]?.steps.map(({ name, sequence, state }) => ({ name, sequence, state })),
    ).toStrictEqual([
      { sequence: 1, name: "ValidatePolicy", state: "SUCCEEDED" },
      { sequence: 2, name: "AskAi", state: "SUCCEEDED" },
      { sequence: 3, name: "SendChatReply", state: "SUCCEEDED" },
    ]);
    expect(aiAdapter.requests).toHaveLength(1);
    expect(chatAdapter.requests[0]?.conversationId).toBe("conversation-hash");
    expect(chatAdapter.requests[0]?.text).toContain("来源：fake-ai-fixture");

    const taskId = tasks[0]?.id;
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${String(taskId)}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${String(taskId)}/cancel`,
    });
    expect(cancelResponse.statusCode).toBe(409);
    expect(cancelResponse.json<{ code: string }>().code).toBe("TASK_TERMINAL");
  });

  it("deduplicates source messages before creating work", async () => {
    const aiAdapter = new FakeAiAdapter();
    const chatAdapter = new FakeChatReplyAdapter();
    const app = await createTestApp(aiAdapter, chatAdapter);

    expect((await app.aiQuestionWorkflow.handleMessage(message("same-message"))).outcome).toBe(
      "TASK_CREATED",
    );
    expect((await app.aiQuestionWorkflow.handleMessage(message("same-message"))).outcome).toBe(
      "DUPLICATE",
    );

    expect(app.aiQuestionWorkflow.listTasks()).toHaveLength(1);
    expect(aiAdapter.requests).toHaveLength(1);
    expect(chatAdapter.requests).toHaveLength(1);
  });

  it.each([
    [{ senderId: "unknown" }, "UNTRUSTED_SENDER"],
    [{ content: "这是一条普通聊天" }, "COMMAND_PREFIX_MISSING"],
    [{ content: "#助手 搜索无线鼠标" }, "COMMAND_UNSUPPORTED"],
    [{ content: "#助手 点击付款" }, "POLICY_DENIED"],
  ])("does not create tasks for rejected input", async (overrides, reason) => {
    const app = await createTestApp();

    await expect(
      app.aiQuestionWorkflow.handleMessage(message(randomUUID(), overrides)),
    ).resolves.toStrictEqual({ outcome: "IGNORED", reason });
    expect(app.aiQuestionWorkflow.listTasks()).toStrictEqual([]);
  });

  it("records adapter failures and skips subsequent steps", async () => {
    const aiAdapter: AiQuestionAdapter = {
      ask: () => Promise.reject(new AdapterError("AI_PAGE_UNAVAILABLE", "fixture unavailable")),
    };
    const app = await createTestApp(aiAdapter);

    await app.aiQuestionWorkflow.handleMessage(message("failure"));
    const task = app.aiQuestionWorkflow.listTasks()[0];

    expect(task).toMatchObject({
      state: "FAILED",
      result: { errorCode: "AI_PAGE_UNAVAILABLE" },
      steps: [
        { state: "SUCCEEDED" },
        { state: "FAILED", errorCode: "AI_PAGE_UNAVAILABLE" },
        { state: "SKIPPED", errorCode: "AI_PAGE_UNAVAILABLE" },
      ],
    });
  });

  it("rejects malformed AI adapter output before sending a reply", async () => {
    const chatAdapter = new FakeChatReplyAdapter();
    const app = await createTestApp(
      new FakeAiAdapter({ answer: "", durationMs: 1, source: "fake-ai-fixture" }),
      chatAdapter,
    );

    await app.aiQuestionWorkflow.handleMessage(message("invalid-adapter-result"));

    expect(app.aiQuestionWorkflow.listTasks()[0]).toMatchObject({
      state: "FAILED",
      result: { errorCode: "SITE_LAYOUT_CHANGED" },
    });
    expect(chatAdapter.requests).toHaveLength(0);
  });

  it("waits for a human when the adapter reports a CAPTCHA", async () => {
    const aiAdapter: AiQuestionAdapter = {
      ask: () => Promise.reject(new AdapterError("CAPTCHA_REQUIRED", "fixture challenge")),
    };
    const app = await createTestApp(aiAdapter);

    await app.aiQuestionWorkflow.handleMessage(message("captcha"));

    expect(app.aiQuestionWorkflow.listTasks()[0]).toMatchObject({
      state: "WAITING_FOR_HUMAN",
      result: { errorCode: "CAPTCHA_REQUIRED" },
      steps: [{ state: "SUCCEEDED" }, { state: "RUNNING" }, { state: "PENDING" }],
    });
  });

  it("aborts a running adapter and marks remaining steps cancelled", async () => {
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const aiAdapter: AiQuestionAdapter = {
      ask: ({ signal }) =>
        new Promise((_resolve, reject) => {
          notifyStarted?.();
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        }),
    };
    const app = await createTestApp(aiAdapter);

    const handling = app.aiQuestionWorkflow.handleMessage(message("cancel"));
    await started;
    const taskId = app.aiQuestionWorkflow.listTasks()[0]?.id;
    expect(taskId).toBeDefined();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${String(taskId)}/cancel`,
    });
    expect(response.statusCode).toBe(202);
    await handling;

    expect(app.aiQuestionWorkflow.getTask(String(taskId))).toMatchObject({
      state: "CANCELLED",
      steps: [
        { state: "SUCCEEDED" },
        { state: "FAILED", errorCode: "TASK_CANCELLED" },
        { state: "SKIPPED", errorCode: "TASK_CANCELLED" },
      ],
    });
  });

  it("completes twenty consecutive simulated end-to-end runs", async () => {
    const aiAdapter = new FakeAiAdapter();
    const chatAdapter = new FakeChatReplyAdapter();
    const app = await createTestApp(aiAdapter, chatAdapter);

    for (let index = 0; index < 20; index += 1) {
      const result = await app.aiQuestionWorkflow.handleMessage(
        message(`stability-${String(index)}`),
      );
      expect(result.outcome).toBe("TASK_CREATED");
    }

    expect(app.aiQuestionWorkflow.listTasks("SUCCEEDED")).toHaveLength(20);
    expect(aiAdapter.requests).toHaveLength(20);
    expect(chatAdapter.requests).toHaveLength(20);
  });

  it("aborts a task past its hard deadline with TASK_TIMED_OUT", async () => {
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const aiAdapter: AiQuestionAdapter = {
      ask: ({ signal }) =>
        new Promise((_resolve, reject) => {
          notifyStarted?.();
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("timed out", "TimeoutError")),
            { once: true },
          );
        }),
    };
    const app = await createTestApp(aiAdapter);

    const handling = app.aiQuestionWorkflow.handleMessage(message("timeout"));
    await started;
    const taskId = app.aiQuestionWorkflow.listTasks()[0]?.id;
    expect(taskId).toBeDefined();

    expect(app.aiQuestionWorkflow.timeout(String(taskId))).toBe(true);
    await handling;

    expect(app.aiQuestionWorkflow.getTask(String(taskId))).toMatchObject({
      result: { errorCode: "TASK_TIMED_OUT" },
      state: "FAILED",
    });
  });

  it("returns false when timing out a task that is not active", async () => {
    const app = await createTestApp();
    expect(app.aiQuestionWorkflow.timeout("missing-id")).toBe(false);
  });

  it("retries a transient adapter failure and bumps the step attempt", async () => {
    const ask = vi
      .fn()
      .mockRejectedValueOnce(new AdapterError("NETWORK_ERROR", "temporary blip"))
      .mockResolvedValueOnce({
        answer: "重试后的答案。",
        durationMs: 20,
        source: "retry-fixture",
      });
    const app = await buildApp({
      aiAdapter: { ask },
      chatReplyAdapter: new FakeChatReplyAdapter(),
      retry: new RetryPolicy({ sleep: () => Promise.resolve() }),
      trustedSenderIds: ["trusted-sender"],
    });
    openApps.push(app);

    await app.aiQuestionWorkflow.handleMessage(message("retry"));

    expect(ask).toHaveBeenCalledTimes(2);
    const task = app.aiQuestionWorkflow.listTasks("SUCCEEDED")[0];
    expect(task).toMatchObject({ state: "SUCCEEDED" });
    expect(task?.steps[1]).toMatchObject({ attempt: 2, state: "SUCCEEDED" });
  });

  it("returns a stable not-found error for unknown tasks", async () => {
    const app = await createTestApp();
    const taskId = "99999999-9999-4999-8999-999999999999";

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${taskId}`,
    });
    expect(detailResponse.statusCode).toBe(404);
    expect(detailResponse.json<{ code: string }>().code).toBe("TASK_NOT_FOUND");

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${taskId}/cancel`,
    });
    expect(cancelResponse.statusCode).toBe(404);
    expect(cancelResponse.json<{ code: string }>().code).toBe("TASK_NOT_FOUND");
  });
});

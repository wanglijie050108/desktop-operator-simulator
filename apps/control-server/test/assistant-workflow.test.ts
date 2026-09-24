import { randomUUID } from "node:crypto";

import type { ChatMessageReceived } from "@hos/contracts";
import { describe, expect, it, vi } from "vitest";

import type { AiQuestionCommandPolicy } from "../src/domain/ai-question-command.js";
import { AssistantWorkflow } from "../src/application/assistant-workflow.js";
import type { AiQuestionWorkflow } from "../src/application/ai-question-workflow.js";
import type { ProductSearchWorkflow } from "../src/application/product-search-workflow.js";
import type { InboundMessageRepository } from "../src/infrastructure/database/inbound-message-repository.js";
import type { TaskRecord, TaskRepository } from "../src/infrastructure/database/task-repository.js";

const NOW = new Date("2026-09-24T12:00:00.000Z");

interface Harness {
  aiHandle: ReturnType<typeof vi.fn>;
  aiTimeout: ReturnType<typeof vi.fn>;
  productHandle: ReturnType<typeof vi.fn>;
  productIncomplete: ReturnType<typeof vi.fn>;
  productTimeout: ReturnType<typeof vi.fn>;
  tasksGet: ReturnType<typeof vi.fn>;
  tasksList: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  workflow: AssistantWorkflow;
}

function makeHarness(): Harness {
  const aiHandle = vi.fn();
  const aiTimeout = vi.fn();
  const productHandle = vi.fn();
  const productIncomplete = vi.fn();
  const productTimeout = vi.fn();
  const tasksGet = vi.fn();
  const tasksList = vi.fn();
  const evaluate = vi.fn();
  const insert = vi.fn(() => true);

  const aiQuestionWorkflow = {
    handleAcceptedMessage: aiHandle,
    timeout: aiTimeout,
  } as unknown as AiQuestionWorkflow;
  const productSearchWorkflow = {
    handleAcceptedMessage: productHandle,
    handleIncompleteMessage: productIncomplete,
    timeout: productTimeout,
  } as unknown as ProductSearchWorkflow;
  const aiPolicy = { evaluate } as unknown as AiQuestionCommandPolicy;
  const tasks = {
    get: tasksGet,
    list: tasksList,
  } as unknown as TaskRepository;
  const inboundMessages = { insert } as unknown as InboundMessageRepository;

  const workflow = new AssistantWorkflow({
    aiPolicy,
    aiQuestionWorkflow,
    commandPrefix: "#助手",
    inboundMessages,
    now: () => NOW,
    productSearchWorkflow,
    tasks,
  });

  return {
    aiHandle,
    aiTimeout,
    productHandle,
    productIncomplete,
    productTimeout,
    tasksGet,
    tasksList,
    evaluate,
    insert,
    workflow,
  };
}

function record(overrides: Partial<TaskRecord> & Pick<TaskRecord, "state" | "type">): TaskRecord {
  return {
    createdAt: "2026-09-24T11:00:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
    policyVersion: "fixture-v1",
    request: null,
    result: null,
    shortCode: "FIXTURE1",
    steps: [],
    updatedAt: "2026-09-24T11:00:00.000Z",
    ...overrides,
  };
}

function chatMessage(overrides: Partial<ChatMessageReceived["payload"]> = {}): ChatMessageReceived {
  return {
    messageId: randomUUID(),
    payload: {
      conversationId: "conv",
      content: "#助手 问AI：测试",
      externalMessageId: "external-1",
      receivedAt: "2026-09-24T11:59:00.000Z",
      senderId: "sender",
      source: "WECHAT",
      ...overrides,
    },
    schemaVersion: "1.0",
    timestamp: "2026-09-24T11:59:00.000Z",
    type: "chat.message.received",
  };
}

describe("AssistantWorkflow.recoverTask", () => {
  it("replays an interrupted AI question as a fresh system-recovery task", async () => {
    const harness = makeHarness();
    harness.tasksGet.mockReturnValue(
      record({
        request: { conversationId: "old-conv", question: "为什么天是蓝的", source: "WECHAT" },
        state: "INTERRUPTED",
        type: "AI_QUESTION",
      }),
    );
    harness.aiHandle.mockResolvedValue({ outcome: "TASK_CREATED", taskId: "new-task-id" });

    const result = await harness.workflow.recoverTask("11111111-1111-4111-8111-111111111111");

    expect(result).toStrictEqual({ outcome: "TASK_CREATED", taskId: "new-task-id" });
    expect(harness.aiHandle).toHaveBeenCalledOnce();
    const [replay, question] = harness.aiHandle.mock.calls[0] as [ChatMessageReceived, string];
    expect(question).toBe("为什么天是蓝的");
    expect(replay.payload).toMatchObject({
      content: "",
      conversationId: "old-conv",
      senderId: "system-recovery",
    });
    expect(replay.payload.externalMessageId).toMatch(/^recovery-11111111/iu);
  });

  it("replays a failed product search with the original request", async () => {
    const harness = makeHarness();
    harness.tasksGet.mockReturnValue(
      record({
        request: {
          candidateCount: 2,
          conversationId: "old-conv",
          maxPrice: 200,
          preferences: ["静音"],
          query: "无线鼠标",
          source: "WECHAT",
        },
        state: "FAILED",
        type: "PRODUCT_SEARCH",
      }),
    );
    harness.productHandle.mockResolvedValue({ outcome: "TASK_CREATED", taskId: "new-product" });

    const result = await harness.workflow.recoverTask("11111111-1111-4111-8111-111111111111");

    expect(result).toStrictEqual({ outcome: "TASK_CREATED", taskId: "new-product" });
    const [, productRequest] = harness.productHandle.mock.calls[0] as [
      ChatMessageReceived,
      { query: string; maxPrice: number },
    ];
    expect(productRequest).toMatchObject({ maxPrice: 200, query: "无线鼠标" });
  });

  it("rejects recovery of unknown tasks", async () => {
    const harness = makeHarness();
    harness.tasksGet.mockReturnValue(undefined);

    await expect(harness.workflow.recoverTask("missing")).resolves.toStrictEqual({
      code: "TASK_NOT_FOUND",
      outcome: "REJECTED",
    });
    expect(harness.aiHandle).not.toHaveBeenCalled();
  });

  it("rejects recovery of tasks in non-recoverable states", async () => {
    const harness = makeHarness();
    harness.tasksGet.mockReturnValue(record({ state: "SUCCEEDED", type: "AI_QUESTION" }));

    await expect(harness.workflow.recoverTask("id")).resolves.toStrictEqual({
      code: "TASK_NOT_RECOVERABLE",
      outcome: "REJECTED",
    });
  });

  it("rejects AI tasks whose stored request no longer contains a question", async () => {
    const harness = makeHarness();
    harness.tasksGet.mockReturnValue(
      record({
        request: { conversationId: "conv", source: "WECHAT" },
        state: "FAILED",
        type: "AI_QUESTION",
      }),
    );

    await expect(harness.workflow.recoverTask("id")).resolves.toStrictEqual({
      code: "INVALID_TASK_REQUEST",
      outcome: "REJECTED",
    });
  });

  it("rejects product tasks whose stored request is invalid", async () => {
    const harness = makeHarness();
    harness.tasksGet.mockReturnValue(
      record({
        request: {
          candidateCount: 2,
          conversationId: "conv",
          maxPrice: 100,
          source: "WECHAT",
        },
        state: "INTERRUPTED",
        type: "PRODUCT_SEARCH",
      }),
    );

    await expect(harness.workflow.recoverTask("id")).resolves.toStrictEqual({
      code: "INVALID_TASK_REQUEST",
      outcome: "REJECTED",
    });
  });

  it("reports rejection when the replay is not accepted as new work", async () => {
    const harness = makeHarness();
    harness.tasksGet.mockReturnValue(
      record({
        request: { conversationId: "conv", question: "问题", source: "WECHAT" },
        state: "FAILED",
        type: "AI_QUESTION",
      }),
    );
    harness.aiHandle.mockResolvedValue({ outcome: "DUPLICATE" });

    await expect(harness.workflow.recoverTask("id")).resolves.toStrictEqual({
      code: "RECOVERY_REJECTED",
      outcome: "REJECTED",
    });
  });
});

describe("AssistantWorkflow.timeout", () => {
  it("delegates AI task timeouts to the AI workflow", () => {
    const harness = makeHarness();
    harness.tasksGet.mockReturnValue(record({ state: "RUNNING", type: "AI_QUESTION" }));
    harness.aiTimeout.mockReturnValue(true);

    expect(harness.workflow.timeout("task-id")).toBe(true);
    expect(harness.aiTimeout).toHaveBeenCalledWith("task-id");
  });

  it("delegates product task timeouts to the product workflow", () => {
    const harness = makeHarness();
    harness.tasksGet.mockReturnValue(record({ state: "RUNNING", type: "PRODUCT_SEARCH" }));
    harness.productTimeout.mockReturnValue(true);

    expect(harness.workflow.timeout("task-id")).toBe(true);
  });

  it("returns false for tasks that cannot be resolved", () => {
    const harness = makeHarness();
    harness.tasksGet.mockReturnValue(undefined);
    expect(harness.workflow.timeout("missing")).toBe(false);
  });
});

describe("AssistantWorkflow.handleMessage", () => {
  it("returns duplicate when the inbound message was already stored", async () => {
    const harness = makeHarness();
    harness.insert.mockReturnValue(false);

    await expect(harness.workflow.handleMessage(chatMessage())).resolves.toStrictEqual({
      outcome: "DUPLICATE",
    });
  });

  it("routes accepted AI commands to the AI workflow", async () => {
    const harness = makeHarness();
    harness.evaluate.mockReturnValue({ accepted: true, question: "答案是什么" });
    harness.aiHandle.mockResolvedValue({ outcome: "TASK_CREATED", taskId: "t1" });

    const message = chatMessage();
    await expect(harness.workflow.handleMessage(message)).resolves.toStrictEqual({
      outcome: "TASK_CREATED",
      taskId: "t1",
    });
    expect(harness.aiHandle).toHaveBeenCalledWith(message, "答案是什么");
  });

  it("ignores commands rejected for non-unsupported reasons", async () => {
    const harness = makeHarness();
    harness.evaluate.mockReturnValue({ accepted: false, code: "POLICY_DENIED" });

    await expect(harness.workflow.handleMessage(chatMessage())).resolves.toStrictEqual({
      outcome: "IGNORED",
      reason: "POLICY_DENIED",
    });
  });

  it("routes supported-looking commands to the product workflow", async () => {
    const harness = makeHarness();
    harness.evaluate.mockReturnValue({ accepted: false, code: "COMMAND_UNSUPPORTED" });
    harness.productHandle.mockResolvedValue({ outcome: "TASK_CREATED", taskId: "p1" });

    // parseProductSearchCommand decides acceptance based on the real content.
    const message = chatMessage({
      content: "#助手 搜索 300元以内的无线鼠标，选2款",
    });
    await harness.workflow.handleMessage(message);

    expect(harness.productHandle).toHaveBeenCalledOnce();
  });

  it("routes incomplete product commands to the incomplete handler", async () => {
    const harness = makeHarness();
    harness.evaluate.mockReturnValue({ accepted: false, code: "COMMAND_UNSUPPORTED" });
    harness.productIncomplete.mockResolvedValue({ outcome: "TASK_CREATED", taskId: "p2" });

    const message = chatMessage({ content: "#助手 搜索 无线鼠标" });
    await harness.workflow.handleMessage(message);

    expect(harness.productIncomplete).toHaveBeenCalledOnce();
  });
});

describe("AssistantWorkflow task views", () => {
  it("delegates list and get to the task repository", () => {
    const harness = makeHarness();
    const stored = record({ state: "FAILED", type: "AI_QUESTION" });
    harness.tasksList.mockReturnValue([stored]);
    harness.tasksGet.mockReturnValue(stored);

    expect(harness.workflow.listTasks("FAILED")).toStrictEqual([stored]);
    expect(harness.workflow.getTask("id")).toBe(stored);
  });
});

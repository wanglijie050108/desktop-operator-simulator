import { randomUUID } from "node:crypto";

import type { ChatMessageReceived } from "@hos/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdapterError } from "../src/adapters/adapter-error.js";
import {
  FakeLlmDecisionAdapter,
  type LlmDecisionAdapter,
  UnavailableLlmDecisionAdapter,
} from "../src/adapters/llm-decision-adapter.js";
import type {
  ProductCandidate,
  ProductExtractionResult,
  ProductSearchAdapter,
  ProductSearchAdapterRequest,
} from "../src/adapters/product-search-adapter.js";
import type { ChatReplyAdapter, ChatReplyRequest } from "../src/adapters/chat-reply-adapter.js";
import { buildApp } from "../src/app.js";
import { RetryPolicy } from "../src/domain/retry-policy.js";
import type { ObservationSummary } from "../src/domain/observation.js";
import {
  ProductSearchDecisionStrategy,
  type ProductSearchDecisionDrivers,
} from "../src/application/product-search-decision-strategy.js";
import type { TaskRecord } from "../src/infrastructure/database/task-repository.js";

const collectedAt = "2026-09-24T08:00:00.000Z";

function candidate(
  slug: string,
  title: string,
  price: number,
  overrides: Partial<ProductCandidate> = {},
): ProductCandidate {
  return {
    attributes: { features: "无线 静音 办公" },
    collectedAt,
    price,
    rating: 4.8,
    salesText: "已售1万",
    shopName: "Fixture Store",
    title,
    url: `https://shop.fixture.test/products/${slug}`,
    ...overrides,
  };
}

const fixtureExtraction: ProductExtractionResult = {
  adapterVersion: "fixture-v1",
  candidates: [
    candidate("mouse-a", "静音办公鼠标 A", 199),
    candidate("mouse-b", "静音办公鼠标 B", 259, { rating: 4.9, salesText: "已售2万" }),
    candidate("mouse-c", "基础无线鼠标 C", 99, {
      attributes: { features: "无线" },
      rating: null,
      salesText: null,
    }),
    candidate("mouse-over-budget", "超预算鼠标", 399),
  ],
  source: "fixture-shop",
};

class FakeProductSearchAdapter implements ProductSearchAdapter {
  public readonly calls: string[] = [];
  public readonly requests: ProductSearchAdapterRequest[] = [];

  public constructor(private readonly extraction = fixtureExtraction) {}

  public open(request: ProductSearchAdapterRequest): Promise<void> {
    this.calls.push("open");
    this.requests.push(request);
    return Promise.resolve();
  }

  public search(request: ProductSearchAdapterRequest): Promise<void> {
    this.calls.push("search");
    this.requests.push(request);
    return Promise.resolve();
  }

  public extract(request: ProductSearchAdapterRequest): Promise<ProductExtractionResult> {
    this.calls.push("extract");
    this.requests.push(request);
    return Promise.resolve(this.extraction);
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
  content = "#助手 搜索 300元以内的无线鼠标，选3款，优先静音和办公",
): ChatMessageReceived {
  return {
    schemaVersion: "1.0",
    type: "chat.message.received",
    messageId: randomUUID(),
    timestamp: "2026-09-24T08:00:00Z",
    payload: {
      source: "WECHAT",
      externalMessageId,
      conversationId: "conversation-hash",
      senderId: "trusted-sender",
      content,
      receivedAt: "2026-09-24T08:00:00Z",
    },
  };
}

async function createTestApp(
  productSearchAdapter: ProductSearchAdapter = new FakeProductSearchAdapter(),
  chatReplyAdapter: ChatReplyAdapter = new FakeChatReplyAdapter(),
): Promise<FastifyInstance> {
  const app = await buildApp({
    allowedShoppingDomains: ["shop.fixture.test"],
    chatReplyAdapter,
    productSearchAdapter,
    trustedSenderIds: ["trusted-sender"],
  });
  openApps.push(app);
  return app;
}

describe("product search workflow", () => {
  it("persists a successful eight-step task and replies with ranked products", async () => {
    const productAdapter = new FakeProductSearchAdapter();
    const chatAdapter = new FakeChatReplyAdapter();
    const app = await createTestApp(productAdapter, chatAdapter);

    const handled = await app.assistantWorkflow.handleMessage(message("product-success"));
    expect(handled.outcome).toBe("TASK_CREATED");

    const response = await app.inject({ method: "GET", url: "/api/v1/tasks" });
    expect(response.statusCode).toBe(200);
    const task = response.json<TaskRecord[]>()[0];
    expect(task).toMatchObject({
      type: "PRODUCT_SEARCH",
      state: "SUCCEEDED",
      request: {
        candidateCount: 3,
        conversationId: "conversation-hash",
        maxPrice: 300,
        preferences: ["静音", "办公"],
        query: "无线鼠标",
        source: "WECHAT",
      },
    });
    expect(
      task?.steps.map(({ name, sequence, state }) => ({ name, sequence, state })),
    ).toStrictEqual([
      { name: "ParseShoppingRequest", sequence: 1, state: "SUCCEEDED" },
      { name: "ValidateShoppingPolicy", sequence: 2, state: "SUCCEEDED" },
      { name: "OpenShoppingSite", sequence: 3, state: "SUCCEEDED" },
      { name: "SearchProducts", sequence: 4, state: "SUCCEEDED" },
      { name: "ExtractCandidates", sequence: 5, state: "SUCCEEDED" },
      { name: "RankCandidates", sequence: 6, state: "SUCCEEDED" },
      { name: "SummarizeResults", sequence: 7, state: "SUCCEEDED" },
      { name: "SendChatReply", sequence: 8, state: "SUCCEEDED" },
    ]);
    const result = task?.result as {
      adapterVersion: string;
      products: ProductCandidate[];
      source: string;
    };
    expect(result.source).toBe("fixture-shop");
    expect(result.adapterVersion).toBe("fixture-v1");
    expect(result.products).toHaveLength(3);
    expect(result.products.every((product) => product.price <= 300)).toBe(true);
    expect(productAdapter.calls).toStrictEqual(["open", "search", "extract"]);
    expect(chatAdapter.requests).toHaveLength(1);
    expect(chatAdapter.requests[0]?.text).toContain("静音办公鼠标");
    expect(chatAdapter.requests[0]?.text).not.toContain("超预算鼠标");
  });

  it("creates a waiting-for-input task and asks only for missing fields", async () => {
    const chatAdapter = new FakeChatReplyAdapter();
    const app = await createTestApp(new FakeProductSearchAdapter(), chatAdapter);

    await app.assistantWorkflow.handleMessage(message("missing-fields", "#助手 搜索 无线鼠标"));

    const task = app.assistantWorkflow.listTasks()[0];
    expect(task).toMatchObject({
      state: "WAITING_FOR_INPUT",
      result: {
        errorCode: "INVALID_ARGUMENTS",
        missingFields: ["maxPrice", "candidateCount"],
      },
    });
    expect(task?.steps.map(({ errorCode, state }) => ({ errorCode, state }))).toStrictEqual([
      { errorCode: "INVALID_ARGUMENTS", state: "FAILED" },
      ...Array.from({ length: 6 }, () => ({
        errorCode: "WAITING_FOR_INPUT",
        state: "SKIPPED",
      })),
      { errorCode: null, state: "SUCCEEDED" },
    ]);
    expect(chatAdapter.requests[0]?.text).toContain("最高预算、候选数量（1-3款）");
    expect(chatAdapter.requests[0]?.text).not.toContain("商品关键词");
  });

  it.each(["LOGIN_REQUIRED", "CAPTCHA_REQUIRED"] as const)(
    "waits for a human when the shopping adapter reports %s",
    async (code) => {
      const adapter: ProductSearchAdapter = {
        extract: () => Promise.resolve(fixtureExtraction),
        open: () => Promise.reject(new AdapterError(code, "fixture interruption")),
        search: () => Promise.resolve(),
      };
      const app = await createTestApp(adapter);

      await app.assistantWorkflow.handleMessage(message(`human-${code}`));

      const task = app.assistantWorkflow.listTasks()[0];
      expect(task).toMatchObject({
        state: "WAITING_FOR_HUMAN",
        result: { errorCode: code },
      });
      expect(task?.steps.map((step) => step.state)).toStrictEqual([
        "SUCCEEDED",
        "SUCCEEDED",
        "RUNNING",
        "PENDING",
        "PENDING",
        "PENDING",
        "PENDING",
        "PENDING",
      ]);
    },
  );

  it("fails closed on invalid extracted product fields", async () => {
    const app = await createTestApp(
      new FakeProductSearchAdapter({
        ...fixtureExtraction,
        candidates: [candidate("invalid", "Invalid URL", 99, { url: "javascript:alert(1)" })],
      }),
    );

    await app.assistantWorkflow.handleMessage(message("invalid-product"));

    const task = app.assistantWorkflow.listTasks()[0];
    expect(task).toMatchObject({
      state: "FAILED",
      result: { errorCode: "INVALID_PRODUCT_DATA" },
    });
    expect(task?.steps.map(({ errorCode, state }) => ({ errorCode, state }))).toStrictEqual([
      { errorCode: null, state: "SUCCEEDED" },
      { errorCode: null, state: "SUCCEEDED" },
      { errorCode: null, state: "SUCCEEDED" },
      { errorCode: null, state: "SUCCEEDED" },
      { errorCode: "INVALID_PRODUCT_DATA", state: "FAILED" },
      ...Array.from({ length: 3 }, () => ({
        errorCode: "INVALID_PRODUCT_DATA",
        state: "SKIPPED",
      })),
    ]);
  });

  it("maps malformed runtime extraction metadata to a stable error", async () => {
    const adapter = {
      extract: () => Promise.resolve(null),
      open: () => Promise.resolve(),
      search: () => Promise.resolve(),
    } as unknown as ProductSearchAdapter;
    const app = await createTestApp(adapter);

    await app.assistantWorkflow.handleMessage(message("invalid-extraction"));

    expect(app.assistantWorkflow.listTasks()[0]).toMatchObject({
      state: "FAILED",
      result: { errorCode: "INVALID_PRODUCT_DATA" },
    });
  });

  it("deduplicates messages across product and AI intent dispatch", async () => {
    const productAdapter = new FakeProductSearchAdapter();
    const app = await createTestApp(productAdapter);

    expect((await app.assistantWorkflow.handleMessage(message("same-message"))).outcome).toBe(
      "TASK_CREATED",
    );
    expect(
      (
        await app.assistantWorkflow.handleMessage(
          message("same-message", "#助手 问AI：不应再次执行"),
        )
      ).outcome,
    ).toBe("DUPLICATE");
    expect(app.assistantWorkflow.listTasks()).toHaveLength(1);
    expect(productAdapter.calls).toStrictEqual(["open", "search", "extract"]);
  });

  it("aborts a running shopping adapter and skips all later steps", async () => {
    const started = Promise.withResolvers<undefined>();
    const adapter: ProductSearchAdapter = {
      extract: () => Promise.resolve(fixtureExtraction),
      open: () => Promise.resolve(),
      search: ({ signal }) =>
        new Promise((_resolve, reject) => {
          started.resolve(undefined);
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        }),
    };
    const app = await createTestApp(adapter);

    const handling = app.assistantWorkflow.handleMessage(message("cancel-product"));
    await started.promise;
    const taskId = app.assistantWorkflow.listTasks()[0]?.id;
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${String(taskId)}/cancel`,
    });
    expect(response.statusCode).toBe(202);
    await handling;

    const task = app.assistantWorkflow.getTask(String(taskId));
    expect(task).toMatchObject({
      state: "CANCELLED",
    });
    expect(task?.steps.map(({ errorCode, state }) => ({ errorCode, state }))).toStrictEqual([
      { errorCode: null, state: "SUCCEEDED" },
      { errorCode: null, state: "SUCCEEDED" },
      { errorCode: null, state: "SUCCEEDED" },
      { errorCode: "TASK_CANCELLED", state: "FAILED" },
      ...Array.from({ length: 4 }, () => ({
        errorCode: "TASK_CANCELLED",
        state: "SKIPPED",
      })),
    ]);
  });

  it("completes twenty consecutive deterministic fixture runs", async () => {
    const productAdapter = new FakeProductSearchAdapter();
    const chatAdapter = new FakeChatReplyAdapter();
    const app = await createTestApp(productAdapter, chatAdapter);

    for (let index = 0; index < 20; index += 1) {
      const handled = await app.assistantWorkflow.handleMessage(
        message(`product-stability-${String(index)}`),
      );
      expect(handled.outcome).toBe("TASK_CREATED");
    }

    expect(app.assistantWorkflow.listTasks("SUCCEEDED")).toHaveLength(20);
    expect(productAdapter.calls).toHaveLength(60);
    expect(chatAdapter.requests).toHaveLength(20);
  });

  it("aborts a task past its hard deadline with TASK_TIMED_OUT", async () => {
    const started = Promise.withResolvers<undefined>();
    const adapter: ProductSearchAdapter = {
      extract: () => Promise.resolve(fixtureExtraction),
      open: () => Promise.resolve(),
      search: ({ signal }) =>
        new Promise((_resolve, reject) => {
          started.resolve(undefined);
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("timed out", "TimeoutError")),
            { once: true },
          );
        }),
    };
    const app = await createTestApp(adapter);

    const handling = app.assistantWorkflow.handleMessage(message("timeout-product"));
    await started.promise;
    const taskId = app.assistantWorkflow.listTasks()[0]?.id;
    expect(taskId).toBeDefined();

    expect(app.productSearchWorkflow.timeout(String(taskId))).toBe(true);
    await handling;

    expect(app.assistantWorkflow.getTask(String(taskId))).toMatchObject({
      result: { errorCode: "TASK_TIMED_OUT" },
      state: "FAILED",
    });
  });

  it("returns false when timing out a task that is not active", async () => {
    const app = await createTestApp();
    expect(app.productSearchWorkflow.timeout("missing-id")).toBe(false);
  });

  it("retries a transient open failure and bumps the step attempt", async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new AdapterError("NETWORK_ERROR", "temporary blip"))
      .mockResolvedValueOnce(undefined);
    const productAdapter: ProductSearchAdapter = {
      extract: () => Promise.resolve(fixtureExtraction),
      open,
      search: () => Promise.resolve(),
    };
    const app = await buildApp({
      allowedShoppingDomains: ["shop.fixture.test"],
      chatReplyAdapter: new FakeChatReplyAdapter(),
      productSearchAdapter: productAdapter,
      retry: new RetryPolicy({ sleep: () => Promise.resolve() }),
      trustedSenderIds: ["trusted-sender"],
    });
    openApps.push(app);

    await app.assistantWorkflow.handleMessage(message("retry-product"));

    expect(open).toHaveBeenCalledTimes(2);
    const task = app.assistantWorkflow.listTasks("SUCCEEDED")[0];
    expect(task).toMatchObject({ state: "SUCCEEDED" });
    expect(task?.steps[2]).toMatchObject({ attempt: 2, state: "SUCCEEDED" });
  });

  it("uses the failed-closed adapter by default", async () => {
    const app = await buildApp({
      allowedShoppingDomains: ["shop.fixture.test"],
      trustedSenderIds: ["trusted-sender"],
    });
    openApps.push(app);

    await app.assistantWorkflow.handleMessage(message("no-adapter"));

    expect(app.assistantWorkflow.listTasks()[0]).toMatchObject({
      state: "FAILED",
      result: { errorCode: "ADAPTER_NOT_CONFIGURED" },
    });
  });

  it("does not create product tasks for prohibited or untrusted input", async () => {
    const app = await createTestApp();

    await expect(
      app.assistantWorkflow.handleMessage(
        message("payment", "#助手 搜索 300元以内的鼠标，选3款，然后点击付款"),
      ),
    ).resolves.toStrictEqual({ outcome: "IGNORED", reason: "POLICY_DENIED" });
    await expect(
      app.assistantWorkflow.handleMessage({
        ...message("untrusted"),
        payload: { ...message("untrusted").payload, senderId: "unknown" },
      }),
    ).resolves.toStrictEqual({ outcome: "IGNORED", reason: "UNTRUSTED_SENDER" });
    expect(app.assistantWorkflow.listTasks()).toStrictEqual([]);
  });
});

describe("product search workflow with decision-loop seam (Plan B, simulation)", () => {
  const loopCandidates: unknown[] = [
    candidate("mouse-a", "静音办公鼠标 A", 199),
    candidate("mouse-b", "静音办公鼠标 B", 259, { rating: 4.9, salesText: "已售2万" }),
    candidate("mouse-c", "基础无线鼠标 C", 99, {
      attributes: { features: "无线" },
      rating: null,
      salesText: null,
    }),
  ];

  function decisionDrivers(verifies = true): ProductSearchDecisionDrivers {
    return {
      collectCandidates: () => loopCandidates,
      execute: () => Promise.resolve(),
      observe: () =>
        Promise.resolve<ObservationSummary>({
          capturedAt: "2026-09-24T08:00:00.000Z",
          nodeCount: 0,
          redactedNodes: [],
          source: "UIA_TREE",
          truncated: false,
        }),
      verify: () => Promise.resolve(verifies),
    };
  }

  function decisionStrategy(
    llm: LlmDecisionAdapter = new FakeLlmDecisionAdapter({
      action: "DESKTOP_INSPECT_TREE",
      arguments: { processName: "chrome.exe" },
      expectedOutcome: "captured candidates",
      taskComplete: true,
    }),
  ): ProductSearchDecisionStrategy {
    return new ProductSearchDecisionStrategy({
      allowlistedProcessNames: ["chrome.exe"],
      llm,
    });
  }

  async function createDecisionApp(
    strategy = decisionStrategy(),
    drivers = decisionDrivers(),
  ): Promise<FastifyInstance> {
    const app = await buildApp({
      allowedShoppingDomains: ["shop.fixture.test"],
      productSearchDecisionDrivers: drivers,
      productSearchDecisionStrategy: strategy,
      trustedSenderIds: ["trusted-sender"],
    });
    openApps.push(app);
    return app;
  }

  it("routes open/search/extract through the decision loop and replies with ranked products", async () => {
    const chatAdapter = new FakeChatReplyAdapter();
    const app = await buildApp({
      allowedShoppingDomains: ["shop.fixture.test"],
      chatReplyAdapter: chatAdapter,
      productSearchDecisionDrivers: decisionDrivers(),
      productSearchDecisionStrategy: decisionStrategy(),
      trustedSenderIds: ["trusted-sender"],
    });
    openApps.push(app);

    const handled = await app.assistantWorkflow.handleMessage(message("decision-success"));
    expect(handled.outcome).toBe("TASK_CREATED");

    const task = app.assistantWorkflow.listTasks()[0];
    expect(task).toMatchObject({
      state: "SUCCEEDED",
      request: {
        candidateCount: 3,
        maxPrice: 300,
        preferences: ["静音", "办公"],
        query: "无线鼠标",
      },
    });
    expect(
      task?.steps.map(({ name, sequence, state }) => ({ name, sequence, state })),
    ).toStrictEqual([
      { name: "ParseShoppingRequest", sequence: 1, state: "SUCCEEDED" },
      { name: "ValidateShoppingPolicy", sequence: 2, state: "SUCCEEDED" },
      { name: "OpenShoppingSite", sequence: 3, state: "SUCCEEDED" },
      { name: "SearchProducts", sequence: 4, state: "SUCCEEDED" },
      { name: "ExtractCandidates", sequence: 5, state: "SUCCEEDED" },
      { name: "RankCandidates", sequence: 6, state: "SUCCEEDED" },
      { name: "SummarizeResults", sequence: 7, state: "SUCCEEDED" },
      { name: "SendChatReply", sequence: 8, state: "SUCCEEDED" },
    ]);
    const result = task?.result as { products: ProductCandidate[]; source: string };
    expect(result.source).toBe("DECISION_LOOP");
    expect(result.products).toHaveLength(3);
    expect(result.products.every((product) => product.price <= 300)).toBe(true);
    expect(chatAdapter.requests[0]?.text).toContain("静音办公鼠标");
  });

  it("waits for a human when the decision loop has no configured LLM", async () => {
    const app = await createDecisionApp(decisionStrategy(new UnavailableLlmDecisionAdapter()));

    await app.assistantWorkflow.handleMessage(message("decision-unconfigured"));

    const task = app.assistantWorkflow.listTasks()[0];
    expect(task).toMatchObject({
      state: "WAITING_FOR_HUMAN",
      result: { errorCode: "DECISION_WAITING_FOR_HUMAN" },
    });
    expect(task?.steps.map((step) => step.state)).toStrictEqual([
      "SUCCEEDED",
      "SUCCEEDED",
      "RUNNING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
    ]);
  });

  it("fails closed to WAITING_FOR_HUMAN when drivers are missing but a strategy is set", async () => {
    const app = await buildApp({
      allowedShoppingDomains: ["shop.fixture.test"],
      productSearchDecisionStrategy: decisionStrategy(),
      trustedSenderIds: ["trusted-sender"],
    });
    openApps.push(app);

    await app.assistantWorkflow.handleMessage(message("decision-no-drivers"));

    expect(app.assistantWorkflow.listTasks()[0]).toMatchObject({
      state: "FAILED",
      result: { errorCode: "DECISION_NOT_CONFIGURED" },
    });
  });

  it("maps an execution failure inside the loop to a failed task with DECISION_FAILED", async () => {
    const app = await buildApp({
      allowedShoppingDomains: ["shop.fixture.test"],
      productSearchDecisionDrivers: {
        ...decisionDrivers(),
        execute: () => Promise.reject(new AdapterError("DESKTOP_ACTION_FAILED", "agent offline")),
      },
      productSearchDecisionStrategy: decisionStrategy(),
      trustedSenderIds: ["trusted-sender"],
    });
    openApps.push(app);

    await app.assistantWorkflow.handleMessage(message("decision-execute-fail"));

    expect(app.assistantWorkflow.listTasks()[0]).toMatchObject({
      state: "FAILED",
      result: { errorCode: "DECISION_FAILED" },
    });
  });

  it("waits for a human when the verifier never passes and the budget is exhausted", async () => {
    const app = await buildApp({
      allowedShoppingDomains: ["shop.fixture.test"],
      productSearchDecisionDrivers: decisionDrivers(false),
      productSearchDecisionStrategy: decisionStrategy(),
      trustedSenderIds: ["trusted-sender"],
    });
    openApps.push(app);

    await app.assistantWorkflow.handleMessage(message("decision-verify-fail"));

    expect(app.assistantWorkflow.listTasks()[0]).toMatchObject({
      state: "WAITING_FOR_HUMAN",
      result: { errorCode: "DECISION_WAITING_FOR_HUMAN" },
    });
  });
});

import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function fulfillJson(page: Page, pattern: string, json: unknown): Promise<void> {
  await page.route(pattern, (route) => route.fulfill({ contentType: "application/json", json }));
}

function zeroedStatistics() {
  const summary = {
    completedCount: 0,
    duration: { averageMs: 0, count: 0, maxMs: 0, minMs: 0, p50Ms: 0, p95Ms: 0 },
    errorDistribution: [],
    failedCount: 0,
    stateCounts: {},
    succeededCount: 0,
    successRate: null,
    terminalCount: 0,
    totalCount: 0,
  };
  return {
    byType: { AI_QUESTION: summary, PRODUCT_SEARCH: summary },
    generatedAt: "2026-09-24T10:00:00.000Z",
    overall: summary,
    version: "fixture-1",
  };
}

function populatedStatistics() {
  const overall = {
    completedCount: 4,
    duration: { averageMs: 1_200, count: 4, maxMs: 2_600, minMs: 400, p50Ms: 1_000, p95Ms: 2_600 },
    errorDistribution: [
      { code: "AI_PAGE_UNAVAILABLE", count: 1 },
      { code: "UNSPECIFIED", count: 1 },
    ],
    failedCount: 1,
    stateCounts: { CANCELLED: 1, FAILED: 1, SUCCEEDED: 3 },
    succeededCount: 3,
    successRate: 0.75,
    terminalCount: 5,
    totalCount: 5,
  };
  const aiQuestion = {
    completedCount: 4,
    duration: { averageMs: 1_200, count: 4, maxMs: 2_600, minMs: 400, p50Ms: 1_000, p95Ms: 2_600 },
    errorDistribution: [{ code: "AI_PAGE_UNAVAILABLE", count: 1 }],
    failedCount: 1,
    stateCounts: { FAILED: 1, SUCCEEDED: 3 },
    succeededCount: 3,
    successRate: 0.75,
    terminalCount: 4,
    totalCount: 4,
  };
  const productSearch = {
    completedCount: 0,
    duration: { averageMs: 0, count: 0, maxMs: 0, minMs: 0, p50Ms: 0, p95Ms: 0 },
    errorDistribution: [{ code: "UNSPECIFIED", count: 1 }],
    failedCount: 0,
    stateCounts: { CANCELLED: 1 },
    succeededCount: 0,
    successRate: null,
    terminalCount: 1,
    totalCount: 1,
  };
  return {
    byType: { AI_QUESTION: aiQuestion, PRODUCT_SEARCH: productSearch },
    generatedAt: "2026-09-24T10:00:00.000Z",
    overall,
    version: "fixture-1",
  };
}

const agentFixtures = [
  {
    capabilities: ["WECHAT", "AI_QUESTION"],
    id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    lastSeenAt: "2026-09-24T10:00:00.000Z",
    name: "Windows-Desk-01",
    status: "ONLINE",
    version: "0.1.0",
  },
  {
    capabilities: [],
    id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
    lastSeenAt: "2026-09-24T08:00:00.000Z",
    name: "Windows-Desk-02",
    status: "OFFLINE",
    version: "0.1.0",
  },
];

const failedTask = {
  id: "11111111-1111-4111-8111-111111111111",
  shortCode: "A1B2C3D4",
  type: "AI_QUESTION",
  state: "FAILED",
  request: {
    conversationId: "conversation-fixture",
    question: "解释什么是零信任网络，200字以内",
    source: "WECHAT",
  },
  result: { errorCode: "ADAPTER_NOT_CONFIGURED" },
  policyVersion: "ai-question-v1",
  createdAt: "2026-09-24T04:00:00.000Z",
  updatedAt: "2026-09-24T04:00:00.010Z",
  steps: [
    {
      id: "21111111-1111-4111-8111-111111111111",
      taskId: "11111111-1111-4111-8111-111111111111",
      sequence: 1,
      name: "ValidatePolicy",
      state: "SUCCEEDED",
      attempt: 1,
      errorCode: null,
      artifactRefs: [],
      startedAt: "2026-09-24T04:00:00.000Z",
      finishedAt: "2026-09-24T04:00:00.001Z",
    },
    {
      id: "31111111-1111-4111-8111-111111111111",
      taskId: "11111111-1111-4111-8111-111111111111",
      sequence: 2,
      name: "AskAi",
      state: "FAILED",
      attempt: 1,
      errorCode: "ADAPTER_NOT_CONFIGURED",
      artifactRefs: [],
      startedAt: "2026-09-24T04:00:00.001Z",
      finishedAt: "2026-09-24T04:00:00.010Z",
    },
    {
      id: "41111111-1111-4111-8111-111111111111",
      taskId: "11111111-1111-4111-8111-111111111111",
      sequence: 3,
      name: "SendChatReply",
      state: "SKIPPED",
      attempt: 0,
      errorCode: "ADAPTER_NOT_CONFIGURED",
      artifactRefs: [],
      startedAt: null,
      finishedAt: "2026-09-24T04:00:00.010Z",
    },
  ],
};

const recoveredTask = {
  ...failedTask,
  id: "99999999-9999-4999-8999-999999999999",
  result: {
    answer: "零信任网络是一种默认不信任任何请求的安全模型……",
    durationMs: 10,
    source: "fixture",
  },
  shortCode: "E5F6G7H8",
  state: "SUCCEEDED",
  updatedAt: "2026-09-24T04:01:00.010Z",
};

for (const viewport of viewports) {
  test(`renders task and step details without overflow on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.route("**/api/v1/tasks*", async (route) => {
      await route.fulfill({ contentType: "application/json", json: [failedTask] });
    });
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "任务" })).toBeVisible();
    await expect(page.getByText("解释什么是零信任网络，200字以内").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "执行步骤" })).toBeVisible();
    await expect(page.getByText("ADAPTER_NOT_CONFIGURED").first()).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`operator-${viewport.name}.png`),
    });
  });

  test(`renders ranked product results without overflow on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.route("**/api/v1/tasks*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: "51111111-1111-4111-8111-111111111111",
            shortCode: "M3A1B2C3",
            type: "PRODUCT_SEARCH",
            state: "SUCCEEDED",
            request: {
              candidateCount: 3,
              conversationId: "conversation-fixture",
              maxPrice: 300,
              preferences: ["静音", "办公"],
              query: "无线鼠标",
              source: "WECHAT",
            },
            result: {
              adapterVersion: "fixture-v1",
              collectedAt: "2026-09-24T08:00:00.000Z",
              maxPrice: 300,
              products: [
                {
                  attributes: { features: "静音 办公" },
                  collectedAt: "2026-09-24T08:00:00.000Z",
                  price: 199,
                  rank: 1,
                  rating: 4.8,
                  salesText: "已售1万",
                  score: 0.91,
                  shopName: "Fixture Store",
                  title: "静音办公无线鼠标 A",
                  url: "https://shop.fixture.test/products/mouse-a",
                },
                {
                  attributes: { features: "办公" },
                  collectedAt: "2026-09-24T08:00:00.000Z",
                  price: 159,
                  rank: 2,
                  rating: null,
                  salesText: null,
                  score: 0.7,
                  shopName: null,
                  title: "基础无线鼠标 B",
                  url: "https://shop.fixture.test/products/mouse-b",
                },
              ],
              query: "无线鼠标",
              source: "fixture-shop",
            },
            policyVersion: "product-search-v1",
            createdAt: "2026-09-24T08:00:00.000Z",
            updatedAt: "2026-09-24T08:00:00.010Z",
            steps: [
              "ParseShoppingRequest",
              "ValidateShoppingPolicy",
              "OpenShoppingSite",
              "SearchProducts",
              "ExtractCandidates",
              "RankCandidates",
              "SummarizeResults",
              "SendChatReply",
            ].map((name, index) => ({
              id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
              taskId: "51111111-1111-4111-8111-111111111111",
              sequence: index + 1,
              name,
              state: "SUCCEEDED",
              attempt: 1,
              errorCode: null,
              artifactRefs: [],
              startedAt: "2026-09-24T08:00:00.000Z",
              finishedAt: "2026-09-24T08:00:00.010Z",
            })),
          },
        ],
      });
    });
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expect(page.getByText("商品查询 · M3A1B2C3")).toBeVisible();
    await expect(page.getByText("静音办公无线鼠标 A")).toBeVisible();
    await expect(page.getByText("¥199.00")).toBeVisible();
    await expect(page.getByRole("link", { name: "查看原始商品" }).first()).toHaveAttribute(
      "href",
      "https://shop.fixture.test/products/mouse-a",
    );

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`operator-product-${viewport.name}.png`),
    });
  });

  test(`shows registered agents with heartbeat status on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await fulfillJson(page, "**/api/v1/tasks", []);
    await fulfillJson(page, "**/api/v1/agents", agentFixtures);
    await fulfillJson(page, "**/api/v1/statistics", zeroedStatistics());
    await page.setViewportSize(viewport);
    await page.goto("/");

    await page.getByTestId("view-agents").click();

    await expect(page.getByText("Windows-Desk-01")).toBeVisible();
    await expect(page.getByText("Windows-Desk-02")).toBeVisible();
    await expect(page.getByText("在线", { exact: true })).toBeVisible();
    await expect(page.getByText("离线", { exact: true })).toBeVisible();
    await expect(page.getByText("WECHAT")).toBeVisible();
    await expect(page.getByText("未声明能力")).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`operator-agents-${viewport.name}.png`),
    });
  });

  test(`shows the statistics dashboard with fixture notice on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await fulfillJson(page, "**/api/v1/tasks", []);
    await fulfillJson(page, "**/api/v1/agents", []);
    await fulfillJson(page, "**/api/v1/statistics", populatedStatistics());
    await page.setViewportSize(viewport);
    await page.goto("/");

    await page.getByTestId("view-statistics").click();

    await expect(page.getByTestId("statistics-notice")).toContainText("测试夹具");
    await expect(page.getByTestId("stat-overall")).toContainText("75.0%");
    await expect(page.getByTestId("stat-AI_QUESTION")).toContainText("75.0%");
    await expect(page.getByTestId("stat-PRODUCT_SEARCH")).toContainText("--");
    await expect(page.getByText("AI_PAGE_UNAVAILABLE")).toBeVisible();
    await expect(page.getByText("fixture-1")).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`operator-statistics-${viewport.name}.png`),
    });
  });
}

test("emergency stop arms first and executes only on the second click", async ({ page }) => {
  await fulfillJson(page, "**/api/v1/tasks", []);
  await fulfillJson(page, "**/api/v1/agents", []);
  await fulfillJson(page, "**/api/v1/statistics", zeroedStatistics());
  await page.route("**/api/v1/system/emergency-stop", (route) =>
    route.fulfill({
      contentType: "application/json",
      status: 202,
      json: { accepted: true, notifiedAgents: 1 },
    }),
  );
  await page.goto("/");

  const stopButton = page.getByTestId("emergency-stop");
  await stopButton.click();
  await expect(stopButton).toContainText("再次点击确认急停");
  await expect(
    page.waitForRequest(
      (request) =>
        request.url().includes("/api/v1/system/emergency-stop") && request.method() === "POST",
      { timeout: 500 },
    ),
  ).rejects.toThrow();

  const stopResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/system/emergency-stop") &&
      response.request().method() === "POST",
  );
  await stopButton.click();
  const response = await stopResponse;
  expect(response.status()).toBe(202);
  await expect(stopButton).toContainText("紧急停止");
});

test("recover creates and selects a fresh task from a failed task", async ({ page }) => {
  let recovered = false;
  await page.route("**/api/v1/tasks", (route) => {
    if (route.request().method() !== "GET") {
      return route.fallback();
    }
    return route.fulfill({
      contentType: "application/json",
      json: recovered ? [recoveredTask] : [failedTask],
    });
  });
  await page.route("**/api/v1/tasks/*/recover", (route) => {
    recovered = true;
    return route.fulfill({
      contentType: "application/json",
      status: 201,
      json: recoveredTask,
    });
  });
  await fulfillJson(page, "**/api/v1/agents", []);
  await fulfillJson(page, "**/api/v1/statistics", zeroedStatistics());
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "解释什么是零信任网络，200字以内" }),
  ).toBeVisible();
  await page.getByTestId("recover-task").click();

  await expect(page.getByText("零信任网络是一种默认不信任任何请求的安全模型……")).toBeVisible();
  await expect(page.getByTestId("recover-task")).toHaveCount(0);
});

test("offline degradation demo stays fixture-labelled across every scene", async ({
  page,
}, testInfo) => {
  await page.goto("/offline-demo.html");

  await expect(page.getByTestId("fixture-banner")).toContainText("测试夹具");
  await expect(page.getByTestId("scene-title")).toHaveText("系统就绪");
  await expect(page.getByTestId("agent-line")).toContainText("夹具节点");
  await expect(page.getByTestId("prev")).toBeDisabled();

  await page.getByTestId("next").click();
  await expect(page.getByText("零信任网络默认不信任任何内外网请求")).toBeVisible();

  await page.getByTestId("next").click();
  await expect(page.getByText("夹具商品 A · Fixture Store")).toBeVisible();
  await expect(page.getByText("¥199.00")).toBeVisible();

  await page.getByTestId("next").click();
  await expect(page.getByTestId("intercept")).toContainText("PROHIBITED_ACTION");
  await expect(page.getByTestId("task")).toContainText("REJECTED");

  await page.getByTestId("next").click();
  await expect(page.getByTestId("intercept")).toContainText("紧急停止");
  await expect(page.getByTestId("task")).toContainText("CANCELLED");

  await page.getByTestId("next").click();
  await expect(page.getByText("92.0%")).toBeVisible();
  await expect(page.getByTestId("task")).toContainText("不代表真实站点");
  await expect(page.getByTestId("next")).toBeDisabled();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("offline-demo.png"),
  });
});

test("state filter requests tasks matching the selected state", async ({ page }) => {
  await fulfillJson(page, "**/api/v1/tasks", []);
  await fulfillJson(page, "**/api/v1/agents", []);
  await fulfillJson(page, "**/api/v1/statistics", zeroedStatistics());
  await page.goto("/");

  const stateRequest = page.waitForRequest((request) =>
    request.url().includes("state=INTERRUPTED"),
  );
  await page.getByRole("button", { name: "已中断" }).click();
  await stateRequest;
});

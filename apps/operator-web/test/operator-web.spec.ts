import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const viewport of viewports) {
  test(`renders task and step details without overflow on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.route("**/api/v1/tasks*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
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
          },
        ],
      });
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
}

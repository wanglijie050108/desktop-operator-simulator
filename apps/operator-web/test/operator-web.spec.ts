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
}

import { afterEach, describe, expect, it, vi } from "vitest";

import { AdapterError } from "../src/adapters/adapter-error.js";
import {
  FakeLlmDecisionAdapter,
  OpenAiLlmDecisionAdapter,
  UnavailableLlmDecisionAdapter,
  type LlmDecisionRequest,
} from "../src/adapters/llm-decision-adapter.js";
import { createObservationCapture, renderPromptView } from "../src/domain/observation.js";

const REDACTION_KEY = "llm-adapter-test-redaction-key";
const CAPTURED_AT = "2026-10-24T00:00:00Z";

function request(): LlmDecisionRequest {
  const capture = createObservationCapture(
    [
      {
        automationId: "RootWebArea",
        children: [
          { automationId: "search-box", controlType: "Edit", name: "搜索商品" },
          { controlType: "Button", name: "搜索" },
        ],
        controlType: "Window",
        name: "购物 - Chrome",
      },
    ],
    "UIA_TREE",
    CAPTURED_AT,
    REDACTION_KEY,
  );
  return {
    conversationGoal: "在购物站点搜索无线鼠标并比较前三个结果",
    observation: {
      promptView: renderPromptView(capture.raw),
      round: 1,
      summary: capture.summary,
    },
    signal: new AbortController().signal,
    systemPrompt: "Propose one allowlisted desktop action as JSON.",
    taskId: "11111111-1111-4111-8111-111111111111",
  };
}

function stubFetch(content: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: typeof content === "string" ? content : JSON.stringify(content) },
            },
          ],
          usage: { completion_tokens: 5, prompt_tokens: 7 },
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentUserContent(fetchMock: ReturnType<typeof vi.fn>): string {
  const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
  const body = JSON.parse(call[1].body) as { messages: { content: string; role: string }[] };
  const user = body.messages.find((message) => message.role === "user");
  if (user === undefined) {
    throw new Error("no user message was sent");
  }
  return user.content;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LLM decision adapter prompt", () => {
  it("sends readable UI labels so the model can ground a decision", () => {
    const fetchMock = stubFetch({
      action: "DESKTOP_INSPECT_TREE",
      arguments: { processName: "chrome.exe" },
      reasoning: "need the result list",
      taskComplete: false,
    });
    const adapter = new OpenAiLlmDecisionAdapter({ apiBase: "https://llm.test/v1" });

    void adapter.decide(request());

    const content = sentUserContent(fetchMock);
    expect(content).toContain("搜索商品");
    expect(content).toContain("购物 - Chrome");
    expect(content).toContain("搜索");
  });

  it("wraps the observation in the untrusted delimiter with an explicit warning", async () => {
    const fetchMock = stubFetch({
      action: "DESKTOP_INSPECT_TREE",
      arguments: { processName: "chrome.exe" },
      taskComplete: false,
    });
    const adapter = new OpenAiLlmDecisionAdapter({ apiBase: "https://llm.test/v1" });

    await adapter.decide(request());

    const content = sentUserContent(fetchMock);
    expect(content).toContain("<untrusted-ui-observation>");
    expect(content).toContain("</untrusted-ui-observation>");
    expect(content).toContain("UNTRUSTED DATA");
    // The observation must sit inside the block, not before or after it.
    const open = content.indexOf("<untrusted-ui-observation>");
    const close = content.indexOf("</untrusted-ui-observation>");
    expect(open).toBeLessThan(content.indexOf("搜索商品"));
    expect(content.indexOf("搜索商品")).toBeLessThan(close);
  });

  it("never puts the persisted redacted tokens in the prompt", async () => {
    const fetchMock = stubFetch({
      action: "DESKTOP_INSPECT_TREE",
      arguments: { processName: "chrome.exe" },
      taskComplete: false,
    });
    const adapter = new OpenAiLlmDecisionAdapter({ apiBase: "https://llm.test/v1" });

    await adapter.decide(request());

    const content = sentUserContent(fetchMock);
    // HMAC tokens are for the trace only; tokens in the prompt would blind the model.
    expect(content).not.toMatch(/node:[0-9a-f]{16}/u);
    expect(content).not.toContain("redactedNodes");
  });

  it("reports node counts and truncation alongside the block", async () => {
    const fetchMock = stubFetch({
      action: "DESKTOP_INSPECT_TREE",
      arguments: { processName: "chrome.exe" },
      taskComplete: false,
    });
    const adapter = new OpenAiLlmDecisionAdapter({ apiBase: "https://llm.test/v1" });

    await adapter.decide(request());

    const content = sentUserContent(fetchMock);
    expect(content).toContain("nodes=3");
    expect(content).toContain("omitted=0");
    expect(content).toContain("truncated=false");
  });

  it("passes the proposed action through without granting it authority", async () => {
    stubFetch({
      action: "MOUSE_CLICK",
      arguments: { target: { processName: "chrome.exe" }, x: 1, y: 2 },
      taskComplete: true,
    });
    const adapter = new OpenAiLlmDecisionAdapter({ apiBase: "https://llm.test/v1" });

    const response = await adapter.decide(request());

    // The adapter only reports what the model said; validation happens in the loop.
    expect(response.proposal.action).toBe("MOUSE_CLICK");
    expect(response.proposal.taskComplete).toBe(true);
  });

  it("fails closed when no LLM is configured", async () => {
    const adapter = new UnavailableLlmDecisionAdapter();
    await expect(adapter.decide()).rejects.toMatchObject({
      code: "DECISION_NOT_CONFIGURED",
    });
  });

  it("maps a malformed completion to PROPOSAL_REJECTED", async () => {
    stubFetch("not json at all");
    const adapter = new OpenAiLlmDecisionAdapter({ apiBase: "https://llm.test/v1" });
    await expect(adapter.decide(request())).rejects.toBeInstanceOf(AdapterError);
  });

  it("maps a non-2xx response to LLM_UNAVAILABLE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("upstream down", { status: 503 }))),
    );
    const adapter = new OpenAiLlmDecisionAdapter({ apiBase: "https://llm.test/v1" });
    await expect(adapter.decide(request())).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" });
  });
});

describe("fake decision adapter", () => {
  it("records the request it received so tests can assert on the prompt input", async () => {
    const adapter = new FakeLlmDecisionAdapter({
      action: "DESKTOP_INSPECT_TREE",
      arguments: { processName: "chrome.exe" },
    });

    await adapter.decide(request());

    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0]?.observation.promptView.text).toContain("搜索商品");
  });
});

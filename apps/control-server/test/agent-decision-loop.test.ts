import { describe, expect, it, vi } from "vitest";

import { AdapterError } from "../src/adapters/adapter-error.js";
import { FakeLlmDecisionAdapter } from "../src/adapters/llm-decision-adapter.js";
import { UnavailableLlmDecisionAdapter } from "../src/adapters/llm-decision-adapter.js";
import { AgentDecisionLoop } from "../src/application/agent-decision-loop.js";
import { defaultDecisionBudget } from "../src/domain/decision-budget.js";
import type { ObservationSummary } from "../src/domain/observation.js";
import type { DecisionTrace } from "../src/domain/decision-trace.js";

const ALLOWED = new Set(["chrome.exe"]);

function fakeObservation(round: number): ObservationSummary {
  return {
    capturedAt: "2026-10-23T00:00:00Z",
    nodeCount: round,
    redactedNodes: [],
    source: "UIA_TREE",
    truncated: false,
  };
}

function buildLoop(options: {
  llm: FakeLlmDecisionAdapter | UnavailableLlmDecisionAdapter;
  observe?: (round: number) => Promise<ObservationSummary>;
  execute?: (command: unknown) => Promise<void>;
  verify?: (round: number) => Promise<boolean>;
  budget?: Partial<ReturnType<typeof defaultDecisionBudget>>;
  now?: () => Date;
  signal?: AbortSignal;
}): AgentDecisionLoop {
  const traces: DecisionTrace[] = [];
  const loopOptions: ConstructorParameters<typeof AgentDecisionLoop>[0] = {
    allowlistedProcessNames: ALLOWED,
    budget: { ...defaultDecisionBudget(), ...options.budget },
    conversationGoal: "搜无线鼠标并选3款",
    llm: options.llm,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    observe: options.observe ?? ((round) => Promise.resolve(fakeObservation(round))),
    signal: options.signal ?? new AbortController().signal,
    systemPrompt: "plan-b-system-prompt",
    taskId: "task-id",
    trace: (entry) => traces.push(entry),
    execute: options.execute ?? (() => Promise.resolve()),
    verify: options.verify ?? (() => Promise.resolve(false)),
  };
  if (options.now !== undefined) {
    loopOptions.now = options.now;
  }
  return new AgentDecisionLoop(loopOptions);
}

describe("decision loop (Plan B cross-platform slice)", () => {
  it("returns DECISION_NOT_CONFIGURED mapping when the LLM adapter is unavailable", async () => {
    const loop = buildLoop({ llm: new UnavailableLlmDecisionAdapter() });
    const result = await loop.run();
    expect(result.outcome).toBe("WAITING_FOR_HUMAN");
    expect(result.reason).toBe("DECISION_NOT_CONFIGURED");
  });

  it("executes an accepted proposal and records an ACCEPTED trace", async () => {
    const llm = new FakeLlmDecisionAdapter({
      action: "MOUSE_CLICK",
      arguments: { target: { processName: "chrome.exe", controlType: "Button" } },
      expectedOutcome: "clicked search",
    });
    const execute = vi.fn().mockResolvedValue(undefined);
    const loop = buildLoop({ execute, llm, verify: () => Promise.resolve(false) });

    const result = await loop.run();
    // Budget exhausted after maxRounds of "not complete" proposals.
    expect(result.outcome).toBe("WAITING_FOR_HUMAN");
    expect(result.reason).toBe("DECISION_BUDGET_EXHAUSTED");
    expect(execute).toHaveBeenCalledTimes(defaultDecisionBudget().maxRounds);
    expect(result.commandIds).toHaveLength(defaultDecisionBudget().maxRounds);
    expect(result.traces).toHaveLength(defaultDecisionBudget().maxRounds);
    expect(result.traces.every((t) => t.validationResult === "ACCEPTED")).toBe(true);
    expect(result.traces[0]?.actionType).toBe("MOUSE_CLICK");
  });

  it("succeeds when verify passes and the proposal declares taskComplete", async () => {
    const llm = new FakeLlmDecisionAdapter({
      action: "DESKTOP_INSPECT_TREE",
      arguments: { processName: "chrome.exe" },
      taskComplete: true,
    });
    const verify = vi.fn().mockResolvedValue(true);
    const loop = buildLoop({ llm, verify });

    const result = await loop.run();
    expect(result.outcome).toBe("SUCCEEDED");
    expect(verify).toHaveBeenCalledTimes(1);
    expect(result.traces[0]?.verifierPassed).toBe(true);
  });

  it("rejects an out-of-allowlist proposal and keeps looping without dispatching it", async () => {
    const llm = new FakeLlmDecisionAdapter({
      action: "WINDOW_ACTIVATE",
      arguments: { processName: "notepad.exe" },
    });
    const execute = vi.fn();
    const loop = buildLoop({
      budget: { maxRounds: 4 },
      execute,
      llm,
      verify: () => Promise.resolve(false),
    });

    const result = await loop.run();
    expect(result.outcome).toBe("WAITING_FOR_HUMAN");
    expect(execute).not.toHaveBeenCalled();
    expect(
      result.traces.every((t) => t.validationResult === "REJECTED" && t.actionType === null),
    ).toBe(true);
    expect(result.traces.every((t) => t.rejectionCode === "PROPOSAL_REJECTED")).toBe(true);
  });

  it("terminates WAITING_FOR_HUMAN when the LLM keeps failing and records the code", async () => {
    const llm = new UnavailableLlmDecisionAdapter();
    const loop = buildLoop({ llm });
    const result = await loop.run();
    expect(result.outcome).toBe("WAITING_FOR_HUMAN");
    expect(result.reason).toBe("DECISION_NOT_CONFIGURED");
    expect(result.traces[0]?.validationResult).toBe("REJECTED");
    expect(result.traces[0]?.rejectionCode).toBe("DECISION_NOT_CONFIGURED");
  });

  it("fails closed when execution fails and records the desktop error code", async () => {
    const llm = new FakeLlmDecisionAdapter({
      action: "MOUSE_CLICK",
      arguments: { target: { processName: "chrome.exe", controlType: "Button" } },
    });
    const loop = buildLoop({
      execute: () => Promise.reject(new AdapterError("DESKTOP_ACTION_FAILED", "fg check")),
      llm,
    });

    const result = await loop.run();
    expect(result.outcome).toBe("FAILED");
    expect(result.reason).toBe("DESKTOP_ACTION_FAILED");
    expect(result.traces[0]?.executionResult).toBe("FAILED");
  });

  it("honours a cancellation signal mid-loop", async () => {
    const controller = new AbortController();
    const llm = new FakeLlmDecisionAdapter({
      action: "MOUSE_CLICK",
      arguments: { target: { processName: "chrome.exe", controlType: "Button" } },
    });
    const observe = vi.fn((round: number) => {
      if (round === 2) {
        controller.abort();
      }
      return Promise.resolve(fakeObservation(round));
    });
    const loop = buildLoop({ llm, observe, signal: controller.signal });

    const result = await loop.run();
    expect(result.outcome).toBe("CANCELLED");
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it("stops at the token budget and reports DECISION_BUDGET_EXHAUSTED", async () => {
    const llm = new FakeLlmDecisionAdapter({
      action: "MOUSE_CLICK",
      arguments: { target: { processName: "chrome.exe", controlType: "Button" } },
    });
    const loop = buildLoop({
      budget: { maxRounds: 50, maxTokens: 40 },
      llm,
      verify: () => Promise.resolve(false),
    });

    const result = await loop.run();
    expect(result.outcome).toBe("WAITING_FOR_HUMAN");
    expect(result.reason).toBe("DECISION_BUDGET_EXHAUSTED");
    // Each round consumes 34 prompt + 12 completion = 46 tokens, so it stops after round 1.
    expect(result.tokens).toBe(46);
  });

  it("stops at the wall-clock budget", async () => {
    let clock = 0;
    const llm = new FakeLlmDecisionAdapter({
      action: "MOUSE_CLICK",
      arguments: { target: { processName: "chrome.exe", controlType: "Button" } },
    });
    const loop = buildLoop({
      budget: { maxRounds: 50, maxWallClockMs: 100, maxTokens: 1_000_000 },
      llm,
      now: () => {
        clock += 200;
        return new Date(clock);
      },
      verify: () => Promise.resolve(false),
    });

    const result = await loop.run();
    expect(result.outcome).toBe("WAITING_FOR_HUMAN");
    expect(result.reason).toBe("DECISION_BUDGET_EXHAUSTED");
  });
});

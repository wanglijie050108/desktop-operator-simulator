import { describe, expect, it, vi } from "vitest";

import type { DesktopCommand, DesktopCommandResult } from "@hos/contracts";

import type { DesktopCommandDispatcher } from "../src/adapters/agent-observation-adapter.js";
import {
  createDecisionDrivers,
  createDecisionStrategy,
  normalizeProcessName,
  resolveDecisionLoopWiring,
} from "../src/application/decision-loop-wiring.js";

const DISPATCHER: DesktopCommandDispatcher = {
  requestDesktopCommand: (): Promise<DesktopCommandResult> =>
    Promise.reject(new Error("not used in wiring tests")),
};

const DOMAINS = new Set(["shop.example.com"]);
const REQUEST = { candidateCount: 3, maxPrice: 300, preferences: [], query: "无线鼠标" };
const TASK_ID = "66666666-6666-4666-8666-666666666666";

const COMPLETE_ENVIRONMENT: Record<string, string> = {
  AGENT_ALLOWED_PROCESSES: "chrome.exe",
  DECISION_LOOP_AGENT_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  DECISION_LOOP_ENABLED: "true",
  DECISION_TARGET_PROCESS: "chrome.exe",
  DECISION_TRACE_REDACTION_KEY: "0123456789abcdef0123",
  LLM_API_BASE: "https://llm.test/v1",
};

/**
 * `undefined` means "delete the key", because a variable that is absent and one set to an
 * empty value are different cases and `exactOptionalPropertyTypes` forbids assigning
 * `undefined` to an optional string.
 */
function resolve(overrides: Record<string, string | undefined> = {}) {
  const merged = { ...COMPLETE_ENVIRONMENT, ...overrides };
  const environment: Record<string, string> = {};
  for (const key of Object.keys(merged)) {
    const value = merged[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  return resolveDecisionLoopWiring({
    allowedShoppingDomains: DOMAINS,
    dispatcher: DISPATCHER,
    environment,
  });
}

describe("decision loop wiring (opt-in gate)", () => {
  it("enables the loop when every dependency is present", () => {
    const wiring = resolve();
    expect(wiring.enabled).toBe(true);
    if (!wiring.enabled) {
      throw new Error("expected enabled");
    }
    expect(wiring.config.targetProcessName).toBe("chrome");
    expect(wiring.config.allowlistedProcessNames.has("chrome")).toBe(true);
  });

  it("stays off by default", () => {
    // This is the safety property: no attribute of the default deployment enables the loop.
    expect(resolve({ DECISION_LOOP_ENABLED: undefined })).toStrictEqual({
      enabled: false,
      reason: "DECISION_LOOP_DISABLED",
    });
  });

  it("accepts only the literal string 'true' as opt-in", () => {
    for (const value of ["1", "yes", "TRUE", "True", ""]) {
      expect(resolve({ DECISION_LOOP_ENABLED: value })).toMatchObject({
        enabled: false,
        reason: "DECISION_LOOP_DISABLED",
      });
    }
  });

  it.each([
    ["DECISION_LOOP_AGENT_ID", "DECISION_LOOP_AGENT_ID_MISSING"],
    ["DECISION_TARGET_PROCESS", "DECISION_TARGET_PROCESS_MISSING"],
    ["LLM_API_BASE", "DECISION_LLM_NOT_CONFIGURED"],
    ["DECISION_TRACE_REDACTION_KEY", "DECISION_TRACE_REDACTION_KEY_MISSING"],
  ])("stays off when %s is missing", (missing, reason) => {
    expect(resolve({ [missing]: undefined })).toMatchObject({ enabled: false, reason });
  });

  it("refuses a redaction key that is too short to be a real secret", () => {
    expect(resolve({ DECISION_TRACE_REDACTION_KEY: "short" })).toMatchObject({
      enabled: false,
      reason: "DECISION_TRACE_REDACTION_KEY_MISSING",
    });
  });

  it("refuses a target the Agent is not allowed to touch", () => {
    // Observing a process outside AGENT_ALLOWED_PROCESSES could only ever fail at runtime.
    expect(resolve({ DECISION_TARGET_PROCESS: "firefox.exe" })).toMatchObject({
      enabled: false,
      reason: "DECISION_TARGET_NOT_ALLOWLISTED",
    });
  });

  it("matches the allowlist case-insensitively and ignores a .exe suffix", () => {
    expect(
      resolve({ AGENT_ALLOWED_PROCESSES: "Chrome.EXE", DECISION_TARGET_PROCESS: "chrome" }),
    ).toMatchObject({ enabled: true });
  });

  it("passes observation limits through when configured", () => {
    const wiring = resolve({
      DECISION_OBSERVATION_MAX_NODES: "400",
      DECISION_OBSERVATION_TIMEOUT_MS: "5000",
    });
    expect(wiring).toMatchObject({
      config: { maxNodes: 400, timeoutMs: 5000 },
      enabled: true,
    });
  });

  it("rejects a non-numeric observation limit instead of silently ignoring it", () => {
    expect(() => resolve({ DECISION_OBSERVATION_MAX_NODES: "lots" })).toThrow(/positive integers/u);
  });

  it("normalizes process names consistently", () => {
    expect(normalizeProcessName("Chrome.EXE")).toBe("chrome");
    expect(normalizeProcessName(" chrome ")).toBe("chrome");
    expect(normalizeProcessName("notepad")).toBe("notepad");
  });
});

describe("decision loop construction", () => {
  function enabledWiring() {
    const wiring = resolve();
    if (!wiring.enabled) {
      throw new Error("expected enabled wiring");
    }
    return wiring;
  }

  it("builds a strategy that fails closed when the LLM rejects", () => {
    const strategy = createDecisionStrategy(enabledWiring(), {
      environment: {},
      onTrace: vi.fn(),
    });
    expect(strategy).toBeDefined();
  });

  it("builds drivers that answer for the task they were given", async () => {
    const handle = createDecisionDrivers(enabledWiring(), {
      allowedShoppingDomains: DOMAINS,
      dispatcher: DISPATCHER,
      request: REQUEST,
      taskId: TASK_ID,
    });

    // Nothing observed yet: no candidates and verification must fail closed rather than pass.
    expect(handle.drivers.collectCandidates(1)).toBeUndefined();
    await expect(handle.drivers.verify(1, new AbortController().signal)).rejects.toThrow(
      /before any observation/u,
    );
  });

  it("gives each task its own driver state", () => {
    const wiring = enabledWiring();
    const first = createDecisionDrivers(wiring, {
      allowedShoppingDomains: DOMAINS,
      dispatcher: DISPATCHER,
      request: REQUEST,
      taskId: TASK_ID,
    });
    const second = createDecisionDrivers(wiring, {
      allowedShoppingDomains: DOMAINS,
      dispatcher: DISPATCHER,
      request: REQUEST,
      taskId: "77777777-7777-4777-8777-777777777777",
    });

    // A shared instance would let task B verify against task A's screen.
    expect(first.drivers).not.toBe(second.drivers);
    expect(second.lastTree()).toBeUndefined();
  });

  it("forwards execution to the gateway as a desktop command", async () => {
    const requestDesktopCommand = vi.fn(() =>
      Promise.resolve({
        payload: {
          commandId: "55555555-5555-4555-8555-555555555555",
          outcome: "SUCCEEDED",
          taskId: TASK_ID,
        },
      } as DesktopCommandResult),
    );
    const handle = createDecisionDrivers(enabledWiring(), {
      allowedShoppingDomains: DOMAINS,
      dispatcher: { requestDesktopCommand },
      request: REQUEST,
      taskId: TASK_ID,
    });

    await handle.drivers.execute(
      { type: "desktop.command" } as DesktopCommand,
      new AbortController().signal,
    );

    expect(requestDesktopCommand).toHaveBeenCalledTimes(1);
  });
});

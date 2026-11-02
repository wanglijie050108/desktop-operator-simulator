import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { FakeLlmDecisionAdapter } from "../src/adapters/llm-decision-adapter.js";
import { ReplayLlmDecisionAdapter } from "../src/adapters/replay-llm-decision-adapter.js";
import { AgentDecisionLoop } from "../src/application/agent-decision-loop.js";
import { defaultDecisionBudget } from "../src/domain/decision-budget.js";
import type { DecisionTrace } from "../src/domain/decision-trace.js";
import { createObservationCapture } from "../src/domain/observation.js";
import { openDatabase, type DatabaseContext } from "../src/infrastructure/database/database.js";
import { DecisionTraceRepository } from "../src/infrastructure/database/decision-trace-repository.js";
import { tasks } from "../src/infrastructure/database/schema.js";
import { TaskRepository } from "../src/infrastructure/database/task-repository.js";

const TASK_ID = "66666666-6666-4666-8666-666666666666";
const SECOND_TASK_ID = "77777777-7777-4777-8777-777777777777";
const ALLOWED = new Set(["chrome.exe"]);

const contexts: DatabaseContext[] = [];
afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.close();
  }
});

function buildContext(): {
  context: DatabaseContext;
  repository: DecisionTraceRepository;
  tasks: TaskRepository;
} {
  const context = openDatabase(":memory:");
  contexts.push(context);
  const taskRepository = new TaskRepository(context);
  for (const [id, shortCode] of [
    [TASK_ID, "T0001"],
    [SECOND_TASK_ID, "T0002"],
  ] as const) {
    taskRepository.create({
      createdAt: "2026-11-02T00:00:00.000Z",
      id,
      policyVersion: "test-policy",
      request: { query: "无线鼠标" },
      shortCode,
      steps: [{ id: `${id}-step-1`, name: "观察", sequence: 1 }],
      type: "PRODUCT_SEARCH",
    });
  }
  return {
    context,
    repository: new DecisionTraceRepository(context),
    tasks: taskRepository,
  };
}

function trace(overrides: Partial<DecisionTrace> = {}): DecisionTrace {
  return {
    actionType: null,
    commandId: null,
    completionTokens: 12,
    createdAt: "2026-11-02T00:00:01.000Z",
    executionResult: null,
    id: "11111111-1111-4111-8111-111111111111",
    model: "test-model",
    observationId: "22222222-2222-4222-8222-222222222222",
    promptTokens: 34,
    proposal: { action: "DESKTOP_INSPECT_TREE", arguments: { processName: "chrome.exe" } },
    rejectionCode: null,
    round: 1,
    taskId: TASK_ID,
    validationResult: "REJECTED",
    verifierPassed: false,
    ...overrides,
  };
}

function buildLoop(
  llm: FakeLlmDecisionAdapter | ReplayLlmDecisionAdapter,
  executed: string[],
): AgentDecisionLoop {
  return new AgentDecisionLoop({
    allowlistedProcessNames: ALLOWED,
    budget: defaultDecisionBudget(),
    conversationGoal: "搜无线鼠标",
    execute: (command) => {
      executed.push(`${command.payload.action}:${JSON.stringify(command.payload.arguments)}`);
      return Promise.resolve();
    },
    llm,
    logger: { error: () => undefined, info: () => undefined, warn: () => undefined } as never,
    observe: () =>
      Promise.resolve(
        createObservationCapture(
          [{ controlType: "Window", name: "购物" }],
          "UIA_TREE",
          "2026-11-02T00:00:00Z",
          "replay-test-redaction-key",
        ),
      ),
    signal: new AbortController().signal,
    systemPrompt: "propose one action",
    taskId: TASK_ID,
    trace: () => undefined,
    verify: () => Promise.resolve(false),
  });
}

describe("decision trace persistence (TRACE-01)", () => {
  it("round-trips a trace without losing fields", () => {
    const { repository } = buildContext();
    const original = trace();
    repository.append(original);

    expect(repository.getRound(TASK_ID, 1)).toStrictEqual(original);
  });

  it("returns rounds in ascending order, the only order replay may use", () => {
    const { repository } = buildContext();
    repository.append(trace({ id: "id-3", round: 3 }));
    repository.append(trace({ id: "id-1", round: 1 }));
    repository.append(trace({ id: "id-2", round: 2 }));

    expect(repository.listByTask(TASK_ID).map((entry) => entry.round)).toStrictEqual([1, 2, 3]);
  });

  it("keeps tasks apart", () => {
    const { repository } = buildContext();
    repository.append(trace({ round: 1 }));
    repository.append(trace({ id: "other", round: 1, taskId: SECOND_TASK_ID }));

    expect(repository.listByTask(TASK_ID)).toHaveLength(1);
    expect(repository.listByTask(SECOND_TASK_ID)).toHaveLength(1);
    expect(repository.countByTask(TASK_ID)).toBe(1);
  });

  it("updates a round in place instead of duplicating it", () => {
    const { repository } = buildContext();
    repository.append(trace());
    // The loop may record a round before its outcome is known, then record it again.
    repository.append(
      trace({
        actionType: "DESKTOP_INSPECT_TREE",
        validationResult: "ACCEPTED",
        verifierPassed: true,
      }),
    );

    const rounds = repository.listByTask(TASK_ID);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.validationResult).toBe("ACCEPTED");
    expect(rounds[0]?.verifierPassed).toBe(true);
  });

  it("persists the redacted proposal only, never the UI label it came from", () => {
    const { repository } = buildContext();
    const capture = createObservationCapture(
      [{ controlType: "Text", name: "无线鼠标 ￥199" }],
      "UIA_TREE",
      "2026-11-02T00:00:00Z",
      "trace-test-redaction-key",
    );

    repository.append(
      trace({ proposal: { action: "MOUSE_CLICK", observed: capture.summary.redactedNodes } }),
    );

    const stored = JSON.stringify(repository.getRound(TASK_ID, 1)?.proposal);
    expect(stored).not.toContain("无线鼠标");
    expect(stored).toMatch(/node:[0-9a-f]{16}/u);
  });

  it("drops traces when the owning task is deleted", () => {
    const { context, repository } = buildContext();
    repository.append(trace());
    expect(repository.countByTask(TASK_ID)).toBe(1);

    context.db.delete(tasks).where(eq(tasks.id, TASK_ID)).run();

    // A trace that outlived its task could not be attributed or replayed, so the schema
    // cascades the delete rather than leaving orphans.
    expect(repository.listByTask(TASK_ID)).toStrictEqual([]);
  });
});

describe("decision trace replay (TRACE-01)", () => {
  it("reproduces the same validated action sequence through the same validation chain", async () => {
    const { repository } = buildContext();
    const liveExecuted: string[] = [];
    const live = buildLoop(
      new FakeLlmDecisionAdapter({
        action: "DESKTOP_INSPECT_TREE",
        arguments: { processName: "chrome.exe" },
      }),
      liveExecuted,
    );
    const liveResult = await live.run();
    for (const entry of liveResult.traces) {
      repository.append(entry);
    }

    const replayExecuted: string[] = [];
    const replay = buildLoop(
      new ReplayLlmDecisionAdapter(repository.listByTask(TASK_ID)),
      replayExecuted,
    );
    const replayed = await replay.run();

    expect(replayExecuted).toStrictEqual(liveExecuted);
    expect(replayed.rounds).toBe(liveResult.rounds);
    expect(replayed.outcome).toBe(liveResult.outcome);
    // Validation ran again on the replayed proposals rather than trusting the recording.
    expect(replayed.traces.every((entry) => entry.validationResult === "ACCEPTED")).toBe(true);
  });

  it("re-rejects a proposal the live run rejected, with the same code", async () => {
    const { repository } = buildContext();
    // A target outside the allowlist is refused by stage 5 of the validation chain.
    const live = buildLoop(
      new FakeLlmDecisionAdapter({
        action: "DESKTOP_INSPECT_TREE",
        arguments: { processName: "firefox.exe" },
      }),
      [],
    );
    const liveResult = await live.run();
    for (const entry of liveResult.traces) {
      repository.append(entry);
    }

    const replayExecuted: string[] = [];
    const replayed = await buildLoop(
      new ReplayLlmDecisionAdapter(repository.listByTask(TASK_ID)),
      replayExecuted,
    ).run();

    expect(replayExecuted).toStrictEqual([]);
    expect(liveResult.traces[0]?.rejectionCode).toBe("PROPOSAL_REJECTED");
    expect(replayed.traces[0]?.rejectionCode).toBe("PROPOSAL_REJECTED");
  });

  it("does not invent a round the recording does not contain", async () => {
    const executed: string[] = [];
    const result = await buildLoop(new ReplayLlmDecisionAdapter([]), executed).run();

    // An empty recording must not be presented as a completed run.
    expect(result.outcome).toBe("WAITING_FOR_HUMAN");
    expect(executed).toStrictEqual([]);
  });

  it("reports which rounds it can serve", () => {
    const { repository } = buildContext();
    repository.append(trace({ id: "a", round: 2 }));
    repository.append(trace({ id: "b", round: 1 }));

    expect(
      new ReplayLlmDecisionAdapter(repository.listByTask(TASK_ID)).recordedRounds,
    ).toStrictEqual([1, 2]);
  });
});

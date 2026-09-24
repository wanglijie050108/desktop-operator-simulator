import { randomUUID } from "node:crypto";

import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { TaskReaper } from "../src/application/task-reaper.js";
import type { AssistantWorkflow } from "../src/application/assistant-workflow.js";
import { openDatabase } from "../src/infrastructure/database/database.js";
import {
  TaskRepository,
  type TaskRecord,
  type TaskState,
} from "../src/infrastructure/database/task-repository.js";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function silentLogger(): FastifyBaseLogger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
    child: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function seedTask(
  tasks: TaskRepository,
  type: TaskRecord["type"],
  state: TaskState,
  createdAt: Date,
): TaskRecord {
  const id = randomUUID();
  const timestamp = createdAt.toISOString();
  const stepCount = type === "AI_QUESTION" ? 3 : 8;
  tasks.create({
    id,
    policyVersion: "fixture-v1",
    request:
      type === "AI_QUESTION"
        ? { conversationId: "conv", question: "问题", source: "WECHAT" }
        : {
            candidateCount: 3,
            conversationId: "conv",
            maxPrice: 100,
            preferences: [],
            query: "鼠标",
            source: "WECHAT",
          },
    shortCode: id.replaceAll("-", "").slice(0, 8).toUpperCase(),
    createdAt: timestamp,
    steps: Array.from({ length: stepCount }, (_unused, index) => ({
      id: randomUUID(),
      name: `Step${String(index + 1)}`,
      sequence: index + 1,
    })),
    type,
  });

  if (state === "PLANNED" || state === "RUNNING") {
    tasks.setState(id, ["RECEIVED"], "PLANNED", timestamp);
    tasks.startStep(id, 1, timestamp);
  }
  if (state === "RUNNING") {
    tasks.setState(id, ["PLANNED"], "RUNNING", timestamp);
  }
  return requireTask(tasks, id);
}

function requireTask(tasks: TaskRepository, id: string): TaskRecord {
  const found = tasks.get(id);
  if (found === undefined) {
    throw new Error(`Seeded task ${id} could not be read back`);
  }
  return found;
}

function createReaper(tasks: TaskRepository, timeoutMock: ReturnType<typeof vi.fn>): TaskReaper {
  const assistantWorkflow = { timeout: timeoutMock } as unknown as AssistantWorkflow;
  return new TaskReaper(tasks, assistantWorkflow, silentLogger(), {
    intervalMs: 1_000,
    now: () => NOW,
  });
}

describe("TaskReaper", () => {
  it("marks tasks left mid-execution as interrupted on startup", () => {
    const tasks = new TaskRepository(openDatabase(":memory:"));
    const running = seedTask(tasks, "AI_QUESTION", "RUNNING", new Date("2026-09-24T11:59:50Z"));
    seedTask(tasks, "PRODUCT_SEARCH", "PLANNED", new Date("2026-09-24T11:59:55Z"));
    const reaper = createReaper(tasks, vi.fn());

    expect(reaper.recoverInterruptedTasks()).toBe(2);

    const recovered = requireTask(tasks, running.id);
    expect(recovered.state).toBe("INTERRUPTED");
    expect(recovered.result).toStrictEqual({ errorCode: "RECOVERY_AFTER_RESTART" });
    expect(recovered.steps[0]).toMatchObject({
      errorCode: "RECOVERY_AFTER_RESTART",
      state: "FAILED",
    });
    expect(recovered.steps.slice(1).every((step) => step.state === "SKIPPED")).toBe(true);
  });

  it("is idempotent: a second startup sweep recovers nothing", () => {
    const tasks = new TaskRepository(openDatabase(":memory:"));
    seedTask(tasks, "AI_QUESTION", "RUNNING", new Date("2026-09-24T11:59:50Z"));
    const reaper = createReaper(tasks, vi.fn());

    expect(reaper.recoverInterruptedTasks()).toBe(1);
    expect(reaper.recoverInterruptedTasks()).toBe(0);
  });

  it("aborts tasks past their hard deadline during periodic sweeps", () => {
    const tasks = new TaskRepository(openDatabase(":memory:"));
    seedTask(tasks, "AI_QUESTION", "RUNNING", new Date("2026-09-24T11:58:00Z"));
    seedTask(tasks, "PRODUCT_SEARCH", "RUNNING", new Date("2026-09-24T11:59:30Z"));
    const timeoutMock = vi.fn(() => true);
    const reaper = createReaper(tasks, timeoutMock);

    expect(reaper.reapTimedOut()).toBe(1);
    expect(timeoutMock).toHaveBeenCalledOnce();
  });

  it("leaves tasks alone when the owning workflow cannot abort them", () => {
    const tasks = new TaskRepository(openDatabase(":memory:"));
    const task = seedTask(tasks, "AI_QUESTION", "RUNNING", new Date("2026-09-24T11:58:00Z"));
    const reaper = createReaper(
      tasks,
      vi.fn(() => false),
    );

    expect(reaper.reapTimedOut()).toBe(0);
    expect(tasks.get(task.id)?.state).toBe("RUNNING");
  });

  it("rejects intervals below one second", () => {
    const tasks = new TaskRepository(openDatabase(":memory:"));
    const assistantWorkflow = {} as AssistantWorkflow;
    expect(
      () =>
        new TaskReaper(tasks, assistantWorkflow, silentLogger(), {
          intervalMs: 500,
        }),
    ).toThrow("Task reaper interval must be at least 1000ms");
  });

  it("starts at most one timer and allows closing it", () => {
    const tasks = new TaskRepository(openDatabase(":memory:"));
    const reaper = createReaper(tasks, vi.fn());

    reaper.start();
    reaper.start();
    expect(() => {
      reaper.close();
      reaper.close();
    }).not.toThrow();
  });
});

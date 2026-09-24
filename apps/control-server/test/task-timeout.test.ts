import { describe, expect, it } from "vitest";

import { isTaskTimedOut, TASK_TIMEOUT_MS } from "../src/domain/task-timeout.js";
import type { TaskRecord } from "../src/infrastructure/database/task-repository.js";

const CREATED_AT = "2026-09-24T03:00:00.000Z";

function task(
  type: TaskRecord["type"],
  state: TaskRecord["state"],
  createdAt = CREATED_AT,
): Pick<TaskRecord, "createdAt" | "state" | "type"> {
  return { createdAt, state, type };
}

describe("isTaskTimedOut", () => {
  it("returns false while the deadline has not been reached", () => {
    const now = new Date("2026-09-24T03:01:30.000Z");
    expect(isTaskTimedOut(task("AI_QUESTION", "RUNNING"), now)).toBe(false);
    expect(isTaskTimedOut(task("PRODUCT_SEARCH", "RUNNING"), now)).toBe(false);
  });

  it("returns false exactly at the deadline", () => {
    const aiDeadline = new Date("2026-09-24T03:01:30.000Z");
    const productDeadline = new Date("2026-09-24T03:02:00.000Z");
    expect(isTaskTimedOut(task("AI_QUESTION", "RUNNING"), aiDeadline)).toBe(false);
    expect(isTaskTimedOut(task("PRODUCT_SEARCH", "RUNNING"), productDeadline)).toBe(false);
  });

  it("returns true once the hard deadline has passed", () => {
    const now = new Date("2026-09-24T03:02:01.000Z");
    expect(isTaskTimedOut(task("AI_QUESTION", "RUNNING"), now)).toBe(true);
    expect(isTaskTimedOut(task("PRODUCT_SEARCH", "RUNNING"), now)).toBe(true);
  });

  it.each(["RECEIVED", "PLANNED"] as TaskRecord["state"][])(
    "applies to the %s execution state",
    (state) => {
      const now = new Date("2026-09-24T03:05:00.000Z");
      expect(isTaskTimedOut(task("AI_QUESTION", state), now)).toBe(true);
    },
  );

  it.each([
    "WAITING_FOR_HUMAN",
    "WAITING_FOR_INPUT",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "INTERRUPTED",
  ] as TaskRecord["state"][])("never times out from the %s state", (state) => {
    const now = new Date("2026-09-24T05:00:00.000Z");
    expect(isTaskTimedOut(task("AI_QUESTION", state), now)).toBe(false);
    expect(isTaskTimedOut(task("PRODUCT_SEARCH", state), now)).toBe(false);
  });

  it("exposes the documented per-type deadlines", () => {
    expect(TASK_TIMEOUT_MS).toStrictEqual({
      AI_QUESTION: 90_000,
      PRODUCT_SEARCH: 120_000,
    });
  });
});

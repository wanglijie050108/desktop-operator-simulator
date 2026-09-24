import type { TaskRecord, TaskState } from "../infrastructure/database/task-repository.js";

/**
 * Per-type hard deadlines. A task that stays in an execution state longer than its
 * deadline is aborted and marked failed. Waiting states (human intervention or missing
 * parameters) are not counted: the timer applies only while the system is executing.
 */
export const TASK_TIMEOUT_MS = {
  AI_QUESTION: 90_000,
  PRODUCT_SEARCH: 120_000,
} as const;

export const ACTIVE_EXECUTION_STATES: readonly TaskState[] = ["RECEIVED", "PLANNED", "RUNNING"];

export function isTaskTimedOut(
  task: Pick<TaskRecord, "createdAt" | "state" | "type">,
  now: Date,
): boolean {
  if (!ACTIVE_EXECUTION_STATES.includes(task.state)) {
    return false;
  }

  const deadlineMs = TASK_TIMEOUT_MS[task.type];
  const elapsedMs = now.getTime() - Date.parse(task.createdAt);
  return elapsedMs > deadlineMs;
}

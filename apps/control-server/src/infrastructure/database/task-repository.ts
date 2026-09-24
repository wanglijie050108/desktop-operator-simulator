import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { DatabaseContext } from "./database.js";
import { taskSteps, tasks } from "./schema.js";

export type TaskState =
  | "RECEIVED"
  | "PLANNED"
  | "WAITING_FOR_INPUT"
  | "RUNNING"
  | "WAITING_FOR_HUMAN"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "REJECTED"
  | "INTERRUPTED";

export type TaskStepState = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

export interface TaskStepRecord {
  artifactRefs: unknown[];
  attempt: number;
  errorCode: string | null;
  finishedAt: string | null;
  id: string;
  name: string;
  sequence: number;
  startedAt: string | null;
  state: TaskStepState;
  taskId: string;
}

export interface TaskRecord {
  createdAt: string;
  id: string;
  policyVersion: string;
  request: unknown;
  result: unknown;
  shortCode: string;
  state: TaskState;
  steps: TaskStepRecord[];
  type: "AI_QUESTION" | "PRODUCT_SEARCH";
  updatedAt: string;
}

export interface CreateTaskInput {
  createdAt: string;
  id: string;
  policyVersion: string;
  request: unknown;
  shortCode: string;
  steps: readonly { id: string; name: string; sequence: number }[];
  type: "AI_QUESTION" | "PRODUCT_SEARCH";
}

const TERMINAL_STATES: readonly TaskState[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
  "INTERRUPTED",
];

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

export class TaskRepository {
  public constructor(private readonly context: DatabaseContext) {}

  public create(input: CreateTaskInput): void {
    this.context.db.transaction((transaction) => {
      transaction
        .insert(tasks)
        .values({
          id: input.id,
          shortCode: input.shortCode,
          type: input.type,
          state: "RECEIVED",
          requestJson: JSON.stringify(input.request),
          policyVersion: input.policyVersion,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        })
        .run();
      transaction
        .insert(taskSteps)
        .values(
          input.steps.map((step) => ({
            ...step,
            taskId: input.id,
            state: "PENDING" as const,
            attempt: 0,
            artifactRefsJson: "[]",
          })),
        )
        .run();
    });
  }

  public list(state?: TaskState): TaskRecord[] {
    const rows =
      state === undefined
        ? this.context.db.select().from(tasks).orderBy(desc(tasks.createdAt)).all()
        : this.context.db
            .select()
            .from(tasks)
            .where(eq(tasks.state, state))
            .orderBy(desc(tasks.createdAt))
            .all();
    return rows.map((row) => this.mapTask(row));
  }

  public get(taskId: string): TaskRecord | undefined {
    const row = this.context.db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    return row === undefined ? undefined : this.mapTask(row);
  }

  public setState(
    taskId: string,
    expectedStates: readonly TaskState[],
    state: TaskState,
    updatedAt: string,
    result?: unknown,
  ): boolean {
    const update: {
      resultJson?: string;
      state: TaskState;
      updatedAt: string;
    } = { state, updatedAt };
    if (result !== undefined) {
      update.resultJson = JSON.stringify(result);
    }

    return (
      this.context.db
        .update(tasks)
        .set(update)
        .where(and(eq(tasks.id, taskId), inArray(tasks.state, expectedStates)))
        .run().changes === 1
    );
  }

  public startStep(taskId: string, sequence: number, startedAt: string): boolean {
    return (
      this.context.db
        .update(taskSteps)
        .set({
          state: "RUNNING",
          attempt: 1,
          startedAt,
        })
        .where(
          and(
            eq(taskSteps.taskId, taskId),
            eq(taskSteps.sequence, sequence),
            eq(taskSteps.state, "PENDING"),
          ),
        )
        .run().changes === 1
    );
  }

  public finishStep(
    taskId: string,
    sequence: number,
    state: "SUCCEEDED" | "FAILED",
    finishedAt: string,
    errorCode?: string,
  ): boolean {
    return (
      this.context.db
        .update(taskSteps)
        .set({
          state,
          finishedAt,
          errorCode: errorCode ?? null,
        })
        .where(
          and(
            eq(taskSteps.taskId, taskId),
            eq(taskSteps.sequence, sequence),
            eq(taskSteps.state, "RUNNING"),
          ),
        )
        .run().changes === 1
    );
  }

  public skipPending(taskId: string, finishedAt: string, errorCode: string): number {
    return this.context.db
      .update(taskSteps)
      .set({ state: "SKIPPED", errorCode, finishedAt })
      .where(and(eq(taskSteps.taskId, taskId), eq(taskSteps.state, "PENDING")))
      .run().changes;
  }

  public cancel(taskId: string, updatedAt: string): "CANCELLED" | "NOT_FOUND" | "TERMINAL" {
    return this.context.db.transaction((transaction) => {
      const task = transaction.select().from(tasks).where(eq(tasks.id, taskId)).get();
      if (task === undefined) {
        return "NOT_FOUND";
      }
      if (TERMINAL_STATES.includes(task.state)) {
        return "TERMINAL";
      }

      transaction
        .update(tasks)
        .set({ state: "CANCELLED", updatedAt })
        .where(eq(tasks.id, taskId))
        .run();
      transaction
        .update(taskSteps)
        .set({ state: "FAILED", errorCode: "TASK_CANCELLED", finishedAt: updatedAt })
        .where(and(eq(taskSteps.taskId, taskId), eq(taskSteps.state, "RUNNING")))
        .run();
      transaction
        .update(taskSteps)
        .set({ state: "SKIPPED", errorCode: "TASK_CANCELLED", finishedAt: updatedAt })
        .where(and(eq(taskSteps.taskId, taskId), eq(taskSteps.state, "PENDING")))
        .run();
      return "CANCELLED";
    });
  }

  private mapTask(row: typeof tasks.$inferSelect): TaskRecord {
    const steps = this.context.db
      .select()
      .from(taskSteps)
      .where(eq(taskSteps.taskId, row.id))
      .orderBy(asc(taskSteps.sequence))
      .all()
      .map((step) => ({
        id: step.id,
        taskId: step.taskId,
        sequence: step.sequence,
        name: step.name,
        state: step.state,
        attempt: step.attempt,
        errorCode: step.errorCode,
        artifactRefs: parseJson(step.artifactRefsJson) as unknown[],
        startedAt: step.startedAt,
        finishedAt: step.finishedAt,
      }));

    return {
      id: row.id,
      shortCode: row.shortCode,
      type: row.type,
      state: row.state,
      request: parseJson(row.requestJson),
      result: row.resultJson === null ? null : parseJson(row.resultJson),
      policyVersion: row.policyVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      steps,
    };
  }
}

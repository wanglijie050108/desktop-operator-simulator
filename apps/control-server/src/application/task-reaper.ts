import type { FastifyBaseLogger } from "fastify";

import { ACTIVE_EXECUTION_STATES, isTaskTimedOut } from "../domain/task-timeout.js";
import type { TaskRepository, TaskState } from "../infrastructure/database/task-repository.js";
import type { AssistantWorkflow } from "./assistant-workflow.js";

export interface TaskReaperOptions {
  intervalMs?: number;
  now?: () => Date;
}

/**
 * Reconciles task state with reality:
 * - On startup, tasks left mid-execution by a crash are marked INTERRUPTED. They are
 *   never replayed automatically (see AT-12).
 * - Periodically, tasks past their hard deadline are aborted; the owning workflow
 *   records TASK_TIMED_OUT when the abort is observed.
 */
export class TaskReaper {
  private readonly intervalMs: number;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;

  public constructor(
    private readonly tasks: TaskRepository,
    private readonly assistantWorkflow: AssistantWorkflow,
    private readonly logger: FastifyBaseLogger,
    options: TaskReaperOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 10_000;
    this.now = options.now ?? (() => new Date());

    if (this.intervalMs < 1_000) {
      throw new Error("Task reaper interval must be at least 1000ms");
    }
  }

  public start(): void {
    if (this.timer === null) {
      this.timer = setInterval(() => {
        this.reapTimedOut();
      }, this.intervalMs);
      this.timer.unref();
    }
  }

  public close(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public recoverInterruptedTasks(): number {
    let recovered = 0;
    for (const state of ACTIVE_EXECUTION_STATES) {
      for (const task of this.tasks.list(state)) {
        const timestamp = this.timestamp();
        this.tasks.finishStep(
          task.id,
          this.runningStep(task),
          "FAILED",
          timestamp,
          "RECOVERY_AFTER_RESTART",
        );
        this.tasks.skipPending(task.id, timestamp, "RECOVERY_AFTER_RESTART");
        if (
          this.tasks.setState(task.id, [task.state], "INTERRUPTED", timestamp, {
            errorCode: "RECOVERY_AFTER_RESTART",
          })
        ) {
          recovered += 1;
          this.logger.info(
            { taskId: task.id, previousState: task.state },
            "Task marked interrupted after control server restart",
          );
        }
      }
    }
    return recovered;
  }

  public reapTimedOut(): number {
    let reaped = 0;
    for (const state of ACTIVE_EXECUTION_STATES) {
      for (const task of this.tasks.list(state)) {
        if (isTaskTimedOut(task, this.now()) && this.assistantWorkflow.timeout(task.id)) {
          reaped += 1;
          this.logger.warn({ taskId: task.id }, "Task timed out and was aborted");
        }
      }
    }
    return reaped;
  }

  private runningStep(task: { steps: { sequence: number; state: string }[] }): number {
    return task.steps.find((step) => step.state === "RUNNING")?.sequence ?? 1;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export type { TaskState };

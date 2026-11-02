import { and, asc, eq } from "drizzle-orm";

import type { DecisionTrace } from "../../domain/decision-trace.js";
import type { DatabaseContext } from "./database.js";
import { decisionTraces } from "./schema.js";

/**
 * Persistence for decision traces (TRACE-01).
 *
 * A trace is what makes a non-deterministic run reviewable and replayable: it answers "how
 * many rounds did it take, what was proposed, what did validation say, what did the desktop
 * do". What it must *not* do is answer "what text was on the screen" — the proposal is stored
 * as it arrived, and that already carries HMAC tokens instead of UI labels.
 *
 * `(task_id, round)` is unique. A retried write therefore updates the round rather than
 * duplicating it, which keeps replay ordering unambiguous even if a round is recorded twice.
 */
export class DecisionTraceRepository {
  public constructor(private readonly context: DatabaseContext) {}

  public append(trace: DecisionTrace): void {
    this.context.db
      .insert(decisionTraces)
      .values({
        id: trace.id,
        taskId: trace.taskId,
        round: trace.round,
        observationId: trace.observationId,
        model: trace.model,
        proposalJson: JSON.stringify(trace.proposal),
        validationResult: trace.validationResult,
        rejectionCode: trace.rejectionCode,
        actionType: trace.actionType,
        commandId: trace.commandId,
        executionResult: trace.executionResult,
        verifierPassed: trace.verifierPassed,
        promptTokens: trace.promptTokens,
        completionTokens: trace.completionTokens,
        createdAt: trace.createdAt,
      })
      .onConflictDoUpdate({
        target: [decisionTraces.taskId, decisionTraces.round],
        set: {
          actionType: trace.actionType,
          commandId: trace.commandId,
          completionTokens: trace.completionTokens,
          executionResult: trace.executionResult,
          observationId: trace.observationId,
          promptTokens: trace.promptTokens,
          proposalJson: JSON.stringify(trace.proposal),
          rejectionCode: trace.rejectionCode,
          validationResult: trace.validationResult,
          verifierPassed: trace.verifierPassed,
        },
      })
      .run();
  }

  /** Rounds in ascending order — the only order a replay is allowed to use. */
  public listByTask(taskId: string): DecisionTrace[] {
    return this.context.db
      .select()
      .from(decisionTraces)
      .where(eq(decisionTraces.taskId, taskId))
      .orderBy(asc(decisionTraces.round))
      .all()
      .map((row) => deserialize(row));
  }

  public getRound(taskId: string, round: number): DecisionTrace | undefined {
    const row = this.context.db
      .select()
      .from(decisionTraces)
      .where(and(eq(decisionTraces.taskId, taskId), eq(decisionTraces.round, round)))
      .get();
    return row === undefined ? undefined : deserialize(row);
  }

  public countByTask(taskId: string): number {
    return this.context.db
      .select()
      .from(decisionTraces)
      .where(eq(decisionTraces.taskId, taskId))
      .all().length;
  }
}

type TraceRow = typeof decisionTraces.$inferSelect;

function deserialize(row: TraceRow): DecisionTrace {
  return {
    actionType: row.actionType,
    commandId: row.commandId,
    completionTokens: row.completionTokens,
    createdAt: row.createdAt,
    executionResult: row.executionResult,
    id: row.id,
    model: row.model,
    observationId: row.observationId,
    promptTokens: row.promptTokens,
    proposal: JSON.parse(row.proposalJson) as unknown,
    rejectionCode: row.rejectionCode,
    round: row.round,
    taskId: row.taskId,
    validationResult: row.validationResult,
    verifierPassed: row.verifierPassed,
  };
}

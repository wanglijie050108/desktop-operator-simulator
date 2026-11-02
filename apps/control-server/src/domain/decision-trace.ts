/**
 * Decision-trace entity (FR-15, TRACE-01).
 *
 * One entry per decision round. The proposal is stored redacted (the observation layer
 * already replaced UI labels with HMAC tokens), so the trace answers "why did the agent
 * click here" without persisting untrusted UI text. Replay uses the redacted proposal
 * plus the same validation chain, so replay proves the validation/execution path, not
 * model behaviour.
 */

export type DecisionValidationResult = "ACCEPTED" | "REJECTED";
export type DecisionExecutionResult = "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface DecisionTrace {
  actionType: string | null;
  commandId: string | null;
  createdAt: string;
  executionResult: DecisionExecutionResult | null;
  id: string;
  model: string;
  observationId: string | null;
  promptTokens: number;
  proposal: unknown;
  rejectionCode: string | null;
  round: number;
  taskId: string;
  validationResult: DecisionValidationResult;
  verifierPassed: boolean;
  completionTokens: number;
}

export interface CreateTraceParams {
  actionType?: string | null;
  commandId?: string | null;
  completionTokens?: number;
  createdAt: string;
  executionResult?: DecisionExecutionResult | null;
  id: string;
  model: string;
  observationId?: string | null;
  promptTokens?: number;
  proposal: unknown;
  rejectionCode?: string | null;
  round: number;
  taskId: string;
  validationResult: DecisionValidationResult;
  verifierPassed?: boolean;
}

export function createDecisionTrace(params: CreateTraceParams): DecisionTrace {
  return {
    actionType: params.actionType ?? null,
    commandId: params.commandId ?? null,
    createdAt: params.createdAt,
    executionResult: params.executionResult ?? null,
    id: params.id,
    model: params.model,
    observationId: params.observationId ?? null,
    promptTokens: params.promptTokens ?? 0,
    proposal: params.proposal,
    rejectionCode: params.rejectionCode ?? null,
    round: params.round,
    taskId: params.taskId,
    validationResult: params.validationResult,
    verifierPassed: params.verifierPassed ?? false,
    completionTokens: params.completionTokens ?? 0,
  };
}

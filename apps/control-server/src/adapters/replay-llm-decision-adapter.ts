import { AdapterError } from "./adapter-error.js";
import type {
  LlmDecisionAdapter,
  LlmDecisionRequest,
  LlmDecisionResponse,
  LlmProposal,
} from "./llm-decision-adapter.js";
import type { DecisionTrace } from "../domain/decision-trace.js";

/**
 * Replay adapter: serves recorded proposals to the decision loop instead of calling a model
 * (TRACE-01).
 *
 * The point is not to reproduce the model. It is to prove that *the recorded run still takes
 * the same path through validation and execution*. So this adapter only replaces the LLM
 * call; everything downstream — the five-stage validation chain, the executor, the verifier,
 * the budget — runs exactly as it did live. A recorded proposal that was rejected before is
 * still rejected, and for the same reason.
 *
 * It reads proposals in `round` order and refuses to run past the last recorded round, because
 * silently finishing a shortened replay would let a partial trace look like a complete one.
 */
export class ReplayLlmDecisionAdapter implements LlmDecisionAdapter {
  private readonly byRound: Map<number, DecisionTrace>;

  public constructor(traces: readonly DecisionTrace[]) {
    this.byRound = new Map();
    for (const trace of traces) {
      this.byRound.set(trace.round, trace);
    }
  }

  public async decide(request: LlmDecisionRequest): Promise<LlmDecisionResponse> {
    const round = request.observation.round;
    const trace = this.byRound.get(round);
    if (trace === undefined) {
      throw new AdapterError(
        "LLM_UNAVAILABLE",
        `Replay has no recorded proposal for round ${String(round)}`,
      );
    }

    const proposal = toProposal(trace.proposal);
    if (proposal === null) {
      // A malformed recording is not something to repair: replaying it as "no action" would
      // fabricate a run that never happened.
      throw new AdapterError(
        "PROPOSAL_REJECTED",
        `Recorded proposal for round ${String(round)} is not a structured object`,
      );
    }

    return await Promise.resolve({
      completionTokens: trace.completionTokens,
      promptTokens: trace.promptTokens,
      proposal,
    });
  }

  /** Rounds this adapter can serve; the caller can assert a full replay is possible. */
  public get recordedRounds(): number[] {
    return [...this.byRound.keys()].sort((left, right) => left - right);
  }
}

function toProposal(value: unknown): LlmProposal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const proposal: LlmProposal = {
    arguments:
      typeof record.arguments === "object" &&
      record.arguments !== null &&
      !Array.isArray(record.arguments)
        ? (record.arguments as Record<string, unknown>)
        : {},
  };
  if (record.action !== undefined) {
    proposal.action = record.action;
  }
  if (typeof record.expectedOutcome === "string") {
    proposal.expectedOutcome = record.expectedOutcome;
  }
  if (typeof record.reasoning === "string") {
    proposal.reasoning = record.reasoning;
  }
  if (typeof record.taskComplete === "boolean") {
    proposal.taskComplete = record.taskComplete;
  }
  return proposal;
}

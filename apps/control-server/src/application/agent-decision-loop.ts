import { randomUUID } from "node:crypto";

import type { DesktopCommand } from "@hos/contracts";

import { AdapterError } from "../adapters/adapter-error.js";
import type { LlmDecisionAdapter, LlmProposal } from "../adapters/llm-decision-adapter.js";
import type { ObservationSummary } from "../domain/observation.js";
import type { DecisionBudget } from "../domain/decision-budget.js";
import type { DecisionTrace } from "../domain/decision-trace.js";
import { createDecisionTrace } from "../domain/decision-trace.js";
import { validateProposal } from "../domain/decision-action.js";
import type {
  DecisionAllowedAction,
  ProposalValidationOptions,
} from "../domain/decision-action.js";
import type { FastifyBaseLogger } from "fastify";

/**
 * Plan B decision loop (LOOP-01, cross-platform slice).
 *
 * One round: observe -> ask the LLM for a proposal -> validate through the five-stage
 * chain -> dispatch the allowlisted command via the caller's executor -> run the verifier.
 * The loop owns no execution authority: it only proposes and records. The caller supplies
 * `observe`, `execute`, `verify`, and `trace`, so this module is fully unit-testable with
 * fakes (no Windows desktop, no live model). Termination is bounded by the triple budget;
 * exhaustion yields `DECISION_BUDGET_EXHAUSTED`.
 */

export type DecisionOutcome = "SUCCEEDED" | "WAITING_FOR_HUMAN" | "FAILED" | "CANCELLED";

export interface DecisionLoopOptions {
  allowlistedProcessNames: ReadonlySet<string>;
  budget: DecisionBudget;
  conversationGoal: string;
  llm: LlmDecisionAdapter;
  logger: FastifyBaseLogger;
  now?: () => Date;
  observe: (round: number, signal: AbortSignal) => Promise<ObservationSummary>;
  signal: AbortSignal;
  systemPrompt: string;
  taskId: string;
  trace: (entry: DecisionTrace) => void;
  /**
   * Dispatches a validated command. The loop never constructs a desktop command itself
   * beyond the validated proposal; execution, foreground checks, and idempotency live in
   * the caller's executor (e.g. AgentGateway.requestDesktopCommand).
   */
  execute: (command: DesktopCommand, signal: AbortSignal) => Promise<void>;
  /** Deterministic post-condition check. Returns true when the task goal is met. */
  verify: (round: number, signal: AbortSignal) => Promise<boolean>;
}

export interface DecisionLoopResult {
  commandIds: string[];
  outcome: DecisionOutcome;
  reason?: string;
  rounds: number;
  tokens: number;
  traces: DecisionTrace[];
}

export class AgentDecisionLoop {
  public readonly traces: DecisionTrace[] = [];

  public constructor(private readonly options: DecisionLoopOptions) {}

  public async run(): Promise<DecisionLoopResult> {
    const startedAt = this.options.now?.().getTime() ?? Date.now();
    const commandIds: string[] = [];
    let tokens = 0;
    const validationOptions: ProposalValidationOptions = {
      allowlistedProcessNames: this.options.allowlistedProcessNames,
    };

    for (let round = 1; round <= this.options.budget.maxRounds; round += 1) {
      if (this.options.signal.aborted) {
        return this.finish("CANCELLED", "Task was cancelled", commandIds, tokens, round);
      }
      if (this.wallClockExhausted(startedAt)) {
        return this.finish(
          "WAITING_FOR_HUMAN",
          "DECISION_BUDGET_EXHAUSTED",
          commandIds,
          tokens,
          round,
        );
      }

      const observation = await this.options.observe(round, this.options.signal);
      const observationId = randomUUID();
      let response;
      try {
        response = await this.options.llm.decide({
          conversationGoal: this.options.conversationGoal,
          observation: { round, summary: observation },
          signal: this.options.signal,
          systemPrompt: this.options.systemPrompt,
          taskId: this.options.taskId,
        });
      } catch (error) {
        const code = error instanceof AdapterError ? error.code : "LLM_UNAVAILABLE";
        this.record(round, observationId, null, "REJECTED", code, false, 0, 0);
        return this.finish("WAITING_FOR_HUMAN", code, commandIds, tokens, round);
      }

      tokens += response.promptTokens + response.completionTokens;
      if (tokens > this.options.budget.maxTokens) {
        this.record(
          round,
          observationId,
          response.proposal,
          "REJECTED",
          "DECISION_BUDGET_EXHAUSTED",
          false,
          response.promptTokens,
          response.completionTokens,
        );
        return this.finish(
          "WAITING_FOR_HUMAN",
          "DECISION_BUDGET_EXHAUSTED",
          commandIds,
          tokens,
          round,
        );
      }

      const validation = validateProposal(response.proposal, validationOptions);
      if (validation.status === "rejected") {
        this.record(
          round,
          observationId,
          response.proposal,
          "REJECTED",
          "PROPOSAL_REJECTED",
          false,
          response.promptTokens,
          response.completionTokens,
        );
        // A rejected proposal is not an error to abort the loop over; continue observing.
        continue;
      }

      const commandId = randomUUID();
      commandIds.push(commandId);
      const command = this.toCommand(
        validation.proposal.action,
        validation.proposal.arguments,
        commandId,
      );
      try {
        await this.options.execute(command, this.options.signal);
      } catch (error) {
        const code = error instanceof AdapterError ? error.code : "DESKTOP_ACTION_FAILED";
        this.record(
          round,
          observationId,
          response.proposal,
          "ACCEPTED",
          code,
          false,
          response.promptTokens,
          response.completionTokens,
          validation.proposal.action,
          commandId,
          "FAILED",
        );
        return this.finish("FAILED", code, commandIds, tokens, round);
      }

      let passed: boolean;
      try {
        passed = await this.options.verify(round, this.options.signal);
      } catch (error) {
        const code = error instanceof AdapterError ? error.code : "VERIFIER_FAILED";
        this.record(
          round,
          observationId,
          response.proposal,
          "ACCEPTED",
          code,
          false,
          response.promptTokens,
          response.completionTokens,
          validation.proposal.action,
          commandId,
          "FAILED",
        );
        return this.finish("FAILED", code, commandIds, tokens, round);
      }

      this.record(
        round,
        observationId,
        response.proposal,
        "ACCEPTED",
        null,
        passed,
        response.promptTokens,
        response.completionTokens,
        validation.proposal.action,
        commandId,
        passed ? "SUCCEEDED" : "FAILED",
      );

      if (this.isTaskComplete(response.proposal) && passed) {
        return this.finish("SUCCEEDED", undefined, commandIds, tokens, round);
      }
    }

    return this.finish(
      "WAITING_FOR_HUMAN",
      "DECISION_BUDGET_EXHAUSTED",
      commandIds,
      tokens,
      this.options.budget.maxRounds + 1,
    );
  }

  private wallClockExhausted(startedAt: number): boolean {
    const elapsed = (this.options.now?.().getTime() ?? Date.now()) - startedAt;
    return elapsed > this.options.budget.maxWallClockMs;
  }

  private isTaskComplete(proposal: LlmProposal): boolean {
    return proposal.taskComplete === true;
  }

  private toCommand(
    action: string,
    args: Record<string, unknown>,
    commandId: string,
  ): DesktopCommand {
    // The proposal already passed validateProposal, which checked the action and its
    // arguments against DesktopCommandSchema. The cast is safe by construction.
    return {
      payload: {
        action: action as DecisionAllowedAction,
        arguments: args,
        commandId,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        taskId: this.options.taskId,
      },
      schemaVersion: "1.0" as const,
      messageId: randomUUID(),
      timestamp: this.options.now?.().toISOString() ?? new Date().toISOString(),
      type: "desktop.command",
    } as DesktopCommand;
  }

  private record(
    round: number,
    observationId: string | null,
    proposal: unknown,
    validationResult: "ACCEPTED" | "REJECTED",
    rejectionCode: string | null,
    verifierPassed: boolean,
    promptTokens: number,
    completionTokens: number,
    actionType: string | null = null,
    commandId: string | null = null,
    executionResult: "SUCCEEDED" | "FAILED" | "CANCELLED" | null = null,
  ): void {
    const entry = createDecisionTrace({
      actionType,
      commandId,
      completionTokens,
      createdAt: this.options.now?.().toISOString() ?? new Date().toISOString(),
      executionResult,
      id: randomUUID(),
      model: "decision-loop",
      observationId,
      promptTokens,
      proposal,
      rejectionCode,
      round,
      taskId: this.options.taskId,
      validationResult,
      verifierPassed,
    });
    this.traces.push(entry);
    this.options.trace(entry);
  }

  private finish(
    outcome: DecisionOutcome,
    reason: string | undefined,
    commandIds: string[],
    tokens: number,
    rounds: number,
  ): DecisionLoopResult {
    if (outcome === "CANCELLED") {
      this.options.logger.info({ taskId: this.options.taskId }, "Decision loop cancelled");
    }
    const result: DecisionLoopResult = {
      commandIds,
      outcome,
      rounds,
      tokens,
      traces: this.traces,
    };
    if (reason !== undefined) {
      result.reason = reason;
    }
    return result;
  }
}

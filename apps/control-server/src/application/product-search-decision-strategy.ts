import { AdapterError } from "../adapters/adapter-error.js";
import type { FastifyBaseLogger } from "fastify";
import type { LlmDecisionAdapter } from "../adapters/llm-decision-adapter.js";
import type { DecisionBudget } from "../domain/decision-budget.js";
import { defaultDecisionBudget } from "../domain/decision-budget.js";
import type { ObservationSummary } from "../domain/observation.js";
import type { ProductSearchRequest } from "../domain/product-search-command.js";
import type { DesktopCommand } from "@hos/contracts";

import { AgentDecisionLoop } from "./agent-decision-loop.js";
import type { DecisionTrace } from "../domain/decision-trace.js";

/**
 * Strategy seam (M6, Plan B): drives the GUI to perform open/search/extract via the
 * decision loop instead of the classic site adapter. It replaces steps 3-5 of
 * {@link ProductSearchWorkflow} only when a strategy is injected; the live app keeps the
 * classic path until real observation/execution adapters (Windows + Python Agent) exist.
 *
 * The loop only PROPOSES white-listed `desktop.command` actions; success is decided by the
 * caller-injected deterministic `verify`. The structured product rows are harvested by the
 * caller (e.g. read from the last `DESKTOP_INSPECT_TREE` observation) and returned as an
 * extraction the workflow already knows how to validate and rank.
 */
export interface ProductSearchDecisionStrategyOptions {
  allowlistedProcessNames: ReadonlySet<string> | readonly string[];
  budget?: Partial<DecisionBudget>;
  /** Built from `LLM_API_BASE`/`LLM_API_KEY`/`LLM_MODEL`; may be the fail-closed
   * `UnavailableLlmDecisionAdapter` which maps to `DECISION_NOT_CONFIGURED`. */
  llm: LlmDecisionAdapter;
  logger?: FastifyBaseLogger;
  now?: () => Date;
  systemPrompt?: string;
  trace?: (entry: DecisionTrace) => void;
}

export interface ProductSearchDecisionDrivers {
  collectCandidates: (round: number) => unknown[] | undefined;
  execute: (command: DesktopCommand, signal: AbortSignal) => Promise<void>;
  observe: (round: number, signal: AbortSignal) => Promise<ObservationSummary>;
  verify: (round: number, signal: AbortSignal) => Promise<boolean>;
}

export interface ProductSearchDecisionOutcome {
  adapterVersion: string;
  candidates: unknown[];
  source: string;
}

const DEFAULT_SYSTEM_PROMPT = "plan-b-product-search";

const noopLogger: FastifyBaseLogger = {
  child: () => noopLogger,
  debug: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  info: () => undefined,
  level: "silent",
  silent: () => undefined,
  trace: () => undefined,
  warn: () => undefined,
};

export class ProductSearchDecisionStrategy {
  public constructor(private readonly options: ProductSearchDecisionStrategyOptions) {}

  public async searchSite(
    request: ProductSearchRequest,
    taskId: string,
    signal: AbortSignal,
    drivers: ProductSearchDecisionDrivers,
  ): Promise<ProductSearchDecisionOutcome> {
    const goal =
      `在购物站点完成"${request.query}"的搜索并提取候选（预算¥${request.maxPrice.toFixed(2)}，` +
      `最多${String(request.candidateCount)}款）`;
    const loopOptions: ConstructorParameters<typeof AgentDecisionLoop>[0] = {
      allowlistedProcessNames: new Set(this.options.allowlistedProcessNames),
      budget: { ...defaultDecisionBudget(), ...this.options.budget },
      conversationGoal: goal,
      llm: this.options.llm,
      logger: this.options.logger ?? noopLogger,
      observe: (round, loopSignal) => drivers.observe(round, loopSignal),
      signal,
      systemPrompt: this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      taskId,
      trace: this.options.trace ?? (() => undefined),
      execute: (command, loopSignal) => drivers.execute(command, loopSignal),
      verify: (round, loopSignal) => drivers.verify(round, loopSignal),
    };
    if (this.options.now !== undefined) {
      loopOptions.now = this.options.now;
    }
    const loop = new AgentDecisionLoop(loopOptions);

    const result = await loop.run();
    if (result.outcome === "SUCCEEDED") {
      const lastRound = Math.max(0, result.rounds - 1);
      const candidates =
        drivers.collectCandidates(lastRound) ?? drivers.collectCandidates(result.rounds);
      if (candidates === undefined || candidates.length === 0) {
        throw new AdapterError("NO_PRODUCTS_IN_BUDGET", "Decision loop finished with no products");
      }
      return {
        adapterVersion: "decision-loop-v1",
        candidates,
        source: "DECISION_LOOP",
      };
    }
    if (result.outcome === "WAITING_FOR_HUMAN") {
      throw new AdapterError(
        "DECISION_WAITING_FOR_HUMAN",
        result.reason ?? "Decision loop requires human intervention",
      );
    }
    if (result.outcome === "CANCELLED") {
      throw new DOMException("Decision loop was cancelled", "AbortError");
    }
    throw new AdapterError(
      "DECISION_FAILED",
      result.reason ?? "Decision loop terminated without success",
    );
  }
}

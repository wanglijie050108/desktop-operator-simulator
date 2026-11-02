import { AgentCommandExecutor } from "../adapters/agent-command-executor.js";
import {
  AgentObservationAdapter,
  type DesktopCommandDispatcher,
} from "../adapters/agent-observation-adapter.js";
import {
  loadLlmConfig,
  OpenAiLlmDecisionAdapter,
  type LlmDecisionAdapter,
} from "../adapters/llm-decision-adapter.js";
import { extractProductRows } from "../adapters/product-row-extractor.js";
import { loadDecisionBudget } from "../domain/decision-budget.js";
import type { ProductSearchRequest } from "../domain/product-search-command.js";
import {
  createProductSearchDecisionDrivers,
  type ProductSearchDecisionDriversHandle,
} from "./product-search-decision-drivers.js";
import { ProductSearchDecisionStrategy } from "./product-search-decision-strategy.js";

/**
 * Assembles the Plan B decision loop from environment configuration (LOOP-01, opt-in).
 *
 * The loop stays **off unless explicitly enabled and fully configured**. Turning it on needs
 * all of: `DECISION_LOOP_ENABLED=true`, a target agent, a target process the Agent is already
 * allowed to touch, a usable LLM endpoint, and a redaction key. Anything missing returns a
 * reason and `buildApp` keeps the classic adapter path.
 *
 * That strictness is the point. A half-configured deployment that still ran the loop would
 * either observe a window it cannot act on, or persist a trace it cannot redact.
 */

export interface DecisionLoopWiringEnvironment {
  AGENT_ALLOWED_PROCESSES?: string;
  DECISION_LOOP_AGENT_ID?: string;
  DECISION_LOOP_ENABLED?: string;
  DECISION_OBSERVATION_MAX_NODES?: string;
  DECISION_OBSERVATION_TIMEOUT_MS?: string;
  DECISION_TARGET_PROCESS?: string;
  DECISION_TARGET_TITLE_CONTAINS?: string;
  DECISION_TRACE_REDACTION_KEY?: string;
  [key: string]: string | undefined;
}

export interface DecisionLoopWiringDependencies {
  allowedShoppingDomains: ReadonlySet<string>;
  dispatcher: DesktopCommandDispatcher;
  environment: DecisionLoopWiringEnvironment;
  /** Receives every trace entry; defaults to a no-op until persistence lands (TRACE-01). */
  onTrace?: (entry: unknown) => void;
}

export interface DecisionLoopConfig {
  agentId: string;
  allowlistedProcessNames: ReadonlySet<string>;
  llm: LlmDecisionAdapter;
  maxNodes?: number;
  redactionKey: string;
  targetProcessName: string;
  timeoutMs?: number;
  titleContains?: string;
}

export type DecisionLoopWiring =
  | { enabled: false; reason: DecisionLoopDisabledReason }
  | { config: DecisionLoopConfig; enabled: true };

export type DecisionLoopDisabledReason =
  | "DECISION_LOOP_DISABLED"
  | "DECISION_LOOP_AGENT_ID_MISSING"
  | "DECISION_TARGET_PROCESS_MISSING"
  | "DECISION_TARGET_NOT_ALLOWLISTED"
  | "DECISION_LLM_NOT_CONFIGURED"
  | "DECISION_TRACE_REDACTION_KEY_MISSING";

/** Returns the enabled configuration, or the reason the loop must stay off. */
export function resolveDecisionLoopWiring(
  dependencies: DecisionLoopWiringDependencies,
): DecisionLoopWiring {
  const environment = dependencies.environment;
  if (environment.DECISION_LOOP_ENABLED !== "true") {
    return { enabled: false, reason: "DECISION_LOOP_DISABLED" };
  }

  const agentId = trimmed(environment.DECISION_LOOP_AGENT_ID);
  if (agentId === undefined) {
    return { enabled: false, reason: "DECISION_LOOP_AGENT_ID_MISSING" };
  }

  const targetProcessName = trimmed(environment.DECISION_TARGET_PROCESS);
  if (targetProcessName === undefined) {
    return { enabled: false, reason: "DECISION_TARGET_PROCESS_MISSING" };
  }

  const allowlistedProcessNames = new Set(parseProcessList(environment.AGENT_ALLOWED_PROCESSES));
  const normalizedTarget = normalizeProcessName(targetProcessName);
  if (!allowlistedProcessNames.has(normalizedTarget)) {
    // Observing a process the Agent may not touch could only ever fail, so refuse up front
    // and name the configuration problem instead of surfacing a runtime error later.
    return { enabled: false, reason: "DECISION_TARGET_NOT_ALLOWLISTED" };
  }

  const llm = buildLlmAdapter(environment);
  if (llm === undefined) {
    return { enabled: false, reason: "DECISION_LLM_NOT_CONFIGURED" };
  }

  const redactionKey = trimmed(environment.DECISION_TRACE_REDACTION_KEY);
  if (redactionKey === undefined || redactionKey.length < 16) {
    // Without a key the persistence view cannot exist. Refusing beats silently storing the
    // raw labels the redaction layer is supposed to remove.
    return { enabled: false, reason: "DECISION_TRACE_REDACTION_KEY_MISSING" };
  }

  const config: DecisionLoopConfig = {
    agentId,
    allowlistedProcessNames,
    llm,
    redactionKey,
    targetProcessName: normalizedTarget,
  };
  const maxNodes = readOptionalPositiveInteger(environment.DECISION_OBSERVATION_MAX_NODES);
  if (maxNodes !== undefined) {
    config.maxNodes = maxNodes;
  }
  const timeoutMs = readOptionalPositiveInteger(environment.DECISION_OBSERVATION_TIMEOUT_MS);
  if (timeoutMs !== undefined) {
    config.timeoutMs = timeoutMs;
  }
  const titleContains = trimmed(environment.DECISION_TARGET_TITLE_CONTAINS);
  if (titleContains !== undefined) {
    config.titleContains = titleContains;
  }
  return { config, enabled: true };
}

/** Builds the per-process strategy. It holds no per-task state; `searchSite` takes the request. */
export function createDecisionStrategy(
  wiring: Extract<DecisionLoopWiring, { enabled: true }>,
  options: {
    budget?: ReturnType<typeof loadDecisionBudget>;
    environment: DecisionLoopWiringEnvironment;
    logger?: ConstructorParameters<typeof ProductSearchDecisionStrategy>[0]["logger"];
    now?: () => Date;
    onTrace?: (entry: unknown) => void;
  },
): ProductSearchDecisionStrategy {
  const strategyOptions: ConstructorParameters<typeof ProductSearchDecisionStrategy>[0] = {
    allowlistedProcessNames: wiring.config.allowlistedProcessNames,
    budget: options.budget ?? loadDecisionBudget(options.environment),
    llm: wiring.config.llm,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.onTrace === undefined ? {} : { trace: options.onTrace }),
  };
  return new ProductSearchDecisionStrategy(strategyOptions);
}

/**
 * Builds the drivers for one task.
 *
 * Drivers are per task, not per process: they retain the tree they last observed and the
 * request they verify against, so sharing one across tasks would let task B verify against
 * task A's screen.
 */
export function createDecisionDrivers(
  wiring: Extract<DecisionLoopWiring, { enabled: true }>,
  options: {
    allowedShoppingDomains: ReadonlySet<string>;
    dispatcher: DesktopCommandDispatcher;
    now?: () => Date;
    request: ProductSearchRequest;
    taskId: string;
  },
): ProductSearchDecisionDriversHandle {
  const { config } = wiring;
  const now = options.now ?? (() => new Date());
  const observation = new AgentObservationAdapter({
    agentId: config.agentId,
    dispatcher: options.dispatcher,
    now,
    redactionKey: config.redactionKey,
    taskId: options.taskId,
    ...(config.maxNodes === undefined ? {} : { maxNodes: config.maxNodes }),
    ...(config.timeoutMs === undefined ? {} : { inspectionTimeoutMs: config.timeoutMs }),
  });

  const baseUrl = firstAllowedUrl(options.allowedShoppingDomains);
  return createProductSearchDecisionDrivers({
    allowedDomains: options.allowedShoppingDomains,
    commandExecutor: new AgentCommandExecutor({
      agentId: config.agentId,
      dispatcher: options.dispatcher,
    }),
    extractCandidates: (tree, request) =>
      extractProductRows(tree, request, {
        collectedAt: now().toISOString(),
        ...(baseUrl === undefined ? {} : { baseUrl }),
      }),
    observation,
    request: options.request,
    targetProcessName: config.targetProcessName,
    taskId: options.taskId,
    ...(config.titleContains === undefined ? {} : { titleContains: config.titleContains }),
    ...(config.maxNodes === undefined ? {} : { maxNodes: config.maxNodes }),
    ...(config.timeoutMs === undefined ? {} : { inspectionTimeoutMs: config.timeoutMs }),
  });
}

function buildLlmAdapter(
  environment: DecisionLoopWiringEnvironment,
): LlmDecisionAdapter | undefined {
  const config = loadLlmConfig(environment);
  return config.apiBase === undefined ? undefined : new OpenAiLlmDecisionAdapter(config);
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result === undefined || result === "" ? undefined : result;
}

export function normalizeProcessName(name: string): string {
  const lower = name.trim().toLowerCase();
  return lower.endsWith(".exe") ? lower.slice(0, -4) : lower;
}

function parseProcessList(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => normalizeProcessName(entry))
    .filter((entry) => entry !== "");
}

function readOptionalPositiveInteger(raw: string | undefined): number | undefined {
  const value = trimmed(raw);
  if (value === undefined) {
    return undefined;
  }
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error("Decision observation limits must be positive integers");
  }
  return Number(value);
}

/**
 * Best-effort replay URL for a row whose UI exposes no link.
 *
 * `validateProductCandidates` rejects an empty URL, so without a value every extracted row
 * would fail validation and the loop could never verify. The first allowed domain keeps it
 * inside the allowlist, and the row still carries `source: "uia-tree"` so a reviewer can tell
 * a placeholder from a real link. Real link extraction is part of site calibration.
 */
function firstAllowedUrl(allowedDomains: ReadonlySet<string>): string | undefined {
  const first = [...allowedDomains][0];
  return first === undefined ? undefined : `https://${first}/`;
}

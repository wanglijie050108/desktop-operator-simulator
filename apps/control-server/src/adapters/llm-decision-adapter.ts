import { randomUUID } from "node:crypto";

import { AdapterError } from "./adapter-error.js";

/**
 * LLM action-proposal adapter (LLM-01, Plan B).
 *
 * Uses the OpenAI-compatible chat-completions protocol over the built-in `fetch`
 * (ADR-010 D9: no new npm packages). It is fail-closed: if `LLM_API_BASE` is unset the
 * adapter returns `DECISION_NOT_CONFIGURED` and the decision loop never runs. The model
 * may only *propose* a structured action; the proposal is validated by the five-stage
 * chain before any desktop command is emitted. The model never receives free-form text to
 * send to the user and never gains execution authority.
 */

export interface DecisionObservation {
  round: number;
  summary: {
    nodeCount: number;
    redactedNodes: readonly unknown[];
    source: string;
    truncated: boolean;
  };
}

export interface LlmProposal {
  action?: unknown;
  arguments: Record<string, unknown>;
  expectedOutcome?: string;
  reasoning?: string;
  taskComplete?: boolean;
}

export interface LlmDecisionRequest {
  conversationGoal: string;
  observation: DecisionObservation;
  signal: AbortSignal;
  systemPrompt: string;
  taskId: string;
}

export interface LlmDecisionResponse {
  completionTokens: number;
  proposal: LlmProposal;
  promptTokens: number;
}

export interface LlmDecisionAdapter {
  decide(request: LlmDecisionRequest): Promise<LlmDecisionResponse>;
}

export interface OpenAiLlmConfig {
  apiBase?: string;
  apiKey?: string;
  defaultTimeoutMs?: number;
  model?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function configValue(raw: string | undefined): string | undefined {
  return raw === undefined || raw.trim().length === 0 ? undefined : raw;
}

export function loadLlmConfig(environment: NodeJS.ProcessEnv = process.env): OpenAiLlmConfig {
  const config: OpenAiLlmConfig = {};
  const apiBase = configValue(environment.LLM_API_BASE);
  if (apiBase !== undefined) {
    config.apiBase = apiBase;
  }
  if (environment.LLM_API_KEY !== undefined) {
    config.apiKey = environment.LLM_API_KEY;
  }
  const model = configValue(environment.LLM_MODEL);
  if (model !== undefined) {
    config.model = model;
  }
  return config;
}

function buildUserContent(request: LlmDecisionRequest): string {
  return [
    `Goal: ${request.conversationGoal}`,
    `Round: ${String(request.observation.round)}`,
    `Observation (source=${request.observation.summary.source}, nodes=${String(request.observation.summary.nodeCount)}, truncated=${String(request.observation.summary.truncated)}):`,
    JSON.stringify(request.observation.summary.redactedNodes),
  ].join("\n");
}

/**
 * Validates the JSON returned by the model into a narrow proposal shape. The model is not
 * trusted to produce a valid command; a malformed payload yields `PROPOSAL_REJECTED`.
 */
function coerceProposal(value: unknown): LlmProposal | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.action !== undefined &&
    (typeof record.action !== "string" || record.action.length === 0)
  ) {
    return null;
  }
  if (
    record.arguments !== undefined &&
    (typeof record.arguments !== "object" || record.arguments === null)
  ) {
    return null;
  }
  const proposal: LlmProposal = {
    arguments: record.arguments as Record<string, unknown>,
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
  if (record.taskComplete === true) {
    proposal.taskComplete = true;
  }
  return proposal;
}

export class OpenAiLlmDecisionAdapter implements LlmDecisionAdapter {
  private readonly apiBase: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;

  public constructor(config: OpenAiLlmConfig) {
    if (config.apiBase === undefined) {
      throw new Error(
        "OpenAiLlmDecisionAdapter requires apiBase; use UnavailableLlmDecisionAdapter otherwise",
      );
    }
    this.apiBase = config.apiBase.replace(/\/$/u, "");
    this.apiKey = config.apiKey;
    this.model = config.model ?? "gpt-4o-mini";
    this.timeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async decide(request: LlmDecisionRequest): Promise<LlmDecisionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.apiBase}/chat/completions`, {
        body: JSON.stringify({
          messages: [
            { content: request.systemPrompt, role: "system" },
            { content: buildUserContent(request), role: "user" },
          ],
          model: this.model,
          response_format: { type: "json_object" },
          temperature: 0,
        }),
        headers: {
          "content-type": "application/json",
          ...(this.apiKey === undefined ? {} : { authorization: `Bearer ${this.apiKey}` }),
        },
        method: "POST",
        signal: mergeSignals(controller.signal, request.signal),
      });
      if (!response.ok) {
        const detail = await safeReadError(response).catch(() => "");
        throw new AdapterError(
          "LLM_UNAVAILABLE",
          `LLM chat completion failed (${String(response.status)})${detail}`,
        );
      }
      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { completion_tokens?: number; prompt_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new AdapterError("LLM_UNAVAILABLE", "LLM returned no completion content");
      }
      const proposal = coerceProposal(parseJsonLenient(content));
      if (proposal === null) {
        throw new AdapterError("PROPOSAL_REJECTED", "LLM proposal was not a structured object");
      }
      return {
        completionTokens: data.usage?.completion_tokens ?? 0,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        proposal,
      };
    } catch (error) {
      if (error instanceof AdapterError) {
        throw error;
      }
      throw new AdapterError("LLM_UNAVAILABLE", `LLM request failed: ${String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export class UnavailableLlmDecisionAdapter implements LlmDecisionAdapter {
  public decide(): Promise<LlmDecisionResponse> {
    return Promise.reject(
      new AdapterError(
        "DECISION_NOT_CONFIGURED",
        "A real LLM decision adapter has not been configured",
      ),
    );
  }
}

/** Deterministic provider for unit tests and offline demos; never contacts a network. */
export class FakeLlmDecisionAdapter implements LlmDecisionAdapter {
  public readonly requests: LlmDecisionRequest[] = [];

  public constructor(private readonly proposal: LlmProposal) {}

  public async decide(request: LlmDecisionRequest): Promise<LlmDecisionResponse> {
    this.requests.push(request);
    return await Promise.resolve({
      completionTokens: 12,
      promptTokens: 34,
      proposal: this.proposal,
    });
  }
}

function mergeSignals(external: AbortSignal, request: AbortSignal): AbortSignal {
  if (external.aborted) {
    return external;
  }
  const merged = new AbortController();
  const abort = (): void => merged.abort();
  external.addEventListener("abort", abort, { once: true });
  request.addEventListener("abort", abort, { once: true });
  if (merged.signal.aborted) {
    return merged.signal;
  }
  return merged.signal;
}

function parseJsonLenient(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
    if (fenced?.[1] !== undefined) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function safeReadError(response: Response): Promise<string> {
  const text = await response.text();
  return text.length === 0 ? "" : `: ${text.slice(0, 200)}`;
}

export { randomUUID };

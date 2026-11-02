import { randomUUID } from "node:crypto";

import type { DesktopCommand, DesktopCommandResult } from "@hos/contracts";

import { AdapterError, type AdapterErrorCode } from "./adapter-error.js";
import {
  createObservationCapture,
  rebuildTree,
  type ObservationAdapter,
  type ObservationCapture,
  type ObservationRequest,
  type ObservationSource,
} from "../domain/observation.js";

/**
 * Observation adapter for the Plan B decision loop (OBS-01, real transport).
 *
 * Turns the domain-level "inspect this window" request into a `DESKTOP_INSPECT_TREE`
 * desktop command, sends it through the Agent WebSocket, and converts the returned flat
 * node list back into an `ObservationCapture`.
 *
 * Everything here is fail-closed: a missing Agent, an expired command, a refused policy
 * check, or a reply without an observation payload all raise, so the loop ends in
 * `WAITING_FOR_HUMAN` rather than deciding against a stale or absent picture of the screen.
 */

/**
 * The slice of `AgentGateway` this adapter depends on. Keeping it narrow means the adapter
 * is unit-testable with a plain stub and cannot accidentally reach into gateway internals.
 */
export interface DesktopCommandDispatcher {
  requestDesktopCommand(agentId: string, message: DesktopCommand): Promise<DesktopCommandResult>;
}

export interface AgentObservationAdapterOptions {
  agentId: string;
  /** How long the command may sit unsent before the Agent must reject it. */
  commandTtlMs?: number;
  dispatcher: DesktopCommandDispatcher;
  /** Per-UIA-call timeout handed to the Agent, not a timeout on the whole command. */
  inspectionTimeoutMs?: number;
  maxNodes?: number;
  now?: () => Date;
  /** HMAC key for the persistence-facing view; never leaves this process. */
  redactionKey: string;
  source?: ObservationSource;
  taskId: string;
}

const DEFAULT_COMMAND_TTL_MS = 30_000;
const PROCESS_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/u;

/** Codes the contract allows the Agent to report, mapped one-to-one. */
const AGENT_FAILURE_CODES: ReadonlySet<string> = new Set<AdapterErrorCode>([
  "POLICY_DENIED",
  "INVALID_ARGUMENTS",
  "TARGET_APP_NOT_FOUND",
  "TARGET_WINDOW_NOT_FOUND",
  "TARGET_WINDOW_LOST",
  "TARGET_PROCESS_EXCLUDED",
  "TASK_CANCELLED",
  "COMMAND_EXPIRED",
  "DUPLICATE_COMMAND",
]);

export class AgentObservationAdapter implements ObservationAdapter {
  private readonly commandTtlMs: number;
  private readonly inspectionTimeoutMs: number | undefined;
  private readonly maxNodes: number | undefined;
  private readonly now: () => Date;
  private readonly source: ObservationSource;

  public constructor(private readonly options: AgentObservationAdapterOptions) {
    this.commandTtlMs = options.commandTtlMs ?? DEFAULT_COMMAND_TTL_MS;
    this.inspectionTimeoutMs = options.inspectionTimeoutMs;
    this.maxNodes = options.maxNodes;
    this.now = options.now ?? (() => new Date());
    this.source = options.source ?? "UIA_TREE";
  }

  public async inspect(
    request: ObservationRequest,
    signal: AbortSignal,
  ): Promise<ObservationCapture> {
    const processName = request.target.processName;
    if (!PROCESS_NAME_PATTERN.test(processName)) {
      // The contract rejects a path here too; failing early keeps the error attributable.
      throw new AdapterError(
        "INVALID_ARGUMENTS",
        `Observation target must be a bare process name, got '${processName}'`,
      );
    }
    if (signal.aborted) {
      throw abortError();
    }

    const command = this.buildCommand(request, processName);
    const result = await this.dispatch(command, signal);

    if (result.payload.outcome !== "SUCCEEDED") {
      throw new AdapterError(
        resolveAgentFailureCode(result.payload.errorCode),
        `DESKTOP_INSPECT_TREE ${result.payload.outcome}: ${result.payload.errorCode ?? "no code"}`,
      );
    }

    const observation = result.payload.observation;
    if (observation === undefined) {
      throw new AdapterError(
        "DESKTOP_ACTION_FAILED",
        "Agent reported success but returned no observation payload",
      );
    }

    const rawTree = rebuildTree(observation.nodes);
    if (rawTree.length === 0) {
      throw new AdapterError(
        "DESKTOP_ACTION_FAILED",
        "Agent returned an empty control tree; the window may have closed",
      );
    }

    // The Agent's own truncation is folded into the capture so the loop reports a shortened
    // observation instead of treating a partial tree as the whole window.
    const maxNodes = request.maxNodes ?? this.maxNodes;
    const capture = createObservationCapture(
      rawTree,
      this.source,
      observation.capturedAt,
      this.options.redactionKey,
      ...(maxNodes === undefined ? [] : [maxNodes]),
    );
    return capture;
  }

  private buildCommand(request: ObservationRequest, processName: string): DesktopCommand {
    const issuedAt = this.now();
    const argumentsValue: Record<string, unknown> = { processName };
    if (request.target.titleContains !== undefined) {
      argumentsValue.titleContains = request.target.titleContains;
    }
    const maxNodes = request.maxNodes ?? this.maxNodes;
    if (maxNodes !== undefined) {
      argumentsValue.maxNodes = maxNodes;
    }
    if (this.inspectionTimeoutMs !== undefined) {
      argumentsValue.timeoutMs = this.inspectionTimeoutMs;
    }

    return {
      messageId: randomUUID(),
      payload: {
        action: "DESKTOP_INSPECT_TREE",
        arguments: argumentsValue,
        commandId: randomUUID(),
        expiresAt: new Date(issuedAt.getTime() + this.commandTtlMs).toISOString(),
        taskId: request.taskId,
      },
      schemaVersion: "1.0",
      timestamp: issuedAt.toISOString(),
      type: "desktop.command",
    } as DesktopCommand;
  }

  private async dispatch(
    command: DesktopCommand,
    signal: AbortSignal,
  ): Promise<DesktopCommandResult> {
    try {
      return await raceAbort(
        this.options.dispatcher.requestDesktopCommand(this.options.agentId, command),
        signal,
      );
    } catch (error) {
      throw toAdapterError(error, signal);
    }
  }
}

function resolveAgentFailureCode(code: string | undefined): AdapterErrorCode {
  return code !== undefined && AGENT_FAILURE_CODES.has(code)
    ? (code as AdapterErrorCode)
    : "DESKTOP_ACTION_FAILED";
}

/**
 * `AgentGateway` rejects with plain `Error`s rather than typed adapter errors, so the
 * message has to be inspected. The strings are this repository's own, not external input.
 */
function toAdapterError(error: unknown, signal: AbortSignal): AdapterError {
  if (error instanceof AdapterError) {
    return error;
  }
  if (signal.aborted) {
    return abortError();
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/not connected/iu.test(message)) {
    return new AdapterError("AGENT_UNAVAILABLE", message);
  }
  if (/timed out/iu.test(message)) {
    return new AdapterError("ADAPTER_TIMEOUT", message);
  }
  return new AdapterError("DESKTOP_ACTION_FAILED", message);
}

function abortError(): AdapterError {
  // `AdapterError` rather than a bare AbortError so callers consistently see one error type;
  // the code is what the workflow maps to a cancelled task.
  return new AdapterError("TASK_CANCELLED", "Observation was cancelled");
}

export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

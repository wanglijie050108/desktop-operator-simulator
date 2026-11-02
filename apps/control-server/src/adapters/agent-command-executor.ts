import type { DesktopCommand, DesktopCommandResult } from "@hos/contracts";

import { AdapterError, type AdapterErrorCode } from "./adapter-error.js";
import { raceAbort, type DesktopCommandDispatcher } from "./agent-observation-adapter.js";

/**
 * Executes a validated decision-loop proposal through the Agent WebSocket (LOOP-01 driver).
 *
 * The loop has already run the five-stage validation chain before calling this, so the
 * command is allowed by construction. This adapter is the boundary where "the desktop said
 * no" becomes an error: any outcome other than `SUCCEEDED` raises, which stops the loop
 * instead of letting it verify a state that never happened.
 */
export interface AgentCommandExecutorOptions {
  agentId: string;
  dispatcher: DesktopCommandDispatcher;
}

export class AgentCommandExecutor {
  public constructor(private readonly options: AgentCommandExecutorOptions) {}

  public async execute(command: DesktopCommand, signal: AbortSignal): Promise<void> {
    let result: DesktopCommandResult;
    try {
      result = await raceAbort(
        this.options.dispatcher.requestDesktopCommand(this.options.agentId, command),
        signal,
      );
    } catch (error) {
      throw toAdapterError(error, signal);
    }

    if (result.payload.outcome !== "SUCCEEDED") {
      throw new AdapterError(
        resolveFailureCode(result.payload.errorCode),
        `Desktop command ${result.payload.outcome}: ${result.payload.errorCode ?? "no code"}`,
      );
    }
  }
}

const KNOWN_CODES: ReadonlySet<AdapterErrorCode> = new Set<AdapterErrorCode>([
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

function resolveFailureCode(code: string | undefined): AdapterErrorCode {
  return code !== undefined && KNOWN_CODES.has(code as AdapterErrorCode)
    ? (code as AdapterErrorCode)
    : "DESKTOP_ACTION_FAILED";
}

function toAdapterError(error: unknown, signal: AbortSignal): AdapterError {
  if (error instanceof AdapterError) {
    return error;
  }
  if (signal.aborted) {
    return new AdapterError("TASK_CANCELLED", "Desktop command was cancelled");
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

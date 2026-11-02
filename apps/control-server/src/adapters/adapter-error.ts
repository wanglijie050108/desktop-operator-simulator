export type AdapterErrorCode =
  | "ADAPTER_NOT_CONFIGURED"
  | "ADAPTER_TIMEOUT"
  | "AGENT_UNAVAILABLE"
  | "AI_PAGE_UNAVAILABLE"
  | "DESKTOP_ACTION_FAILED"
  | "NETWORK_ERROR"
  | "REPLY_ABORTED"
  | "SHOPPING_SITE_UNAVAILABLE"
  | "LOGIN_REQUIRED"
  | "CAPTCHA_REQUIRED"
  | "SERVICE_UNAVAILABLE"
  | "SITE_LAYOUT_CHANGED"
  | "TEMPORARY_UNAVAILABLE"
  | "INVALID_PRODUCT_DATA"
  | "NO_PRODUCTS_IN_BUDGET"
  | "LLM_UNAVAILABLE"
  | "PROPOSAL_REJECTED"
  | "VERIFIER_FAILED"
  | "DECISION_NOT_CONFIGURED"
  | "DECISION_WAITING_FOR_HUMAN"
  | "DECISION_FAILED"
  // Agent-reported failures surfaced to the decision layer. Kept distinct instead of
  // collapsing into DESKTOP_ACTION_FAILED so the trace records *why* the desktop refused.
  | "POLICY_DENIED"
  | "INVALID_ARGUMENTS"
  | "TARGET_APP_NOT_FOUND"
  | "TARGET_WINDOW_NOT_FOUND"
  | "TARGET_WINDOW_LOST"
  | "TARGET_PROCESS_EXCLUDED"
  | "TASK_CANCELLED"
  | "COMMAND_EXPIRED"
  | "DUPLICATE_COMMAND";

export class AdapterError extends Error {
  public constructor(
    public readonly code: AdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

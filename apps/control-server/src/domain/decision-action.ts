import { isSchemaValue, DesktopCommandSchema, SCHEMA_VERSION } from "@hos/contracts";

/**
 * Proposal validation chain for Plan B (LLM-01).
 *
 * The LLM is allowed to *propose* only from a narrowed set of GUI-operating actions. A
 * proposal is data, never a command: it passes the same stages a hardcoded workflow step
 * would (schema, action allowlist, argument range, policy, target allowlist) and a
 * rejected proposal is discarded, never "repaired" into something executable. Chat-channel
 * actions (WECHAT_*) are intentionally excluded here because the reply/ingress paths own
 * those; the decision loop operates the shopping GUI only.
 */

const DUMMY_UUID = "00000000-0000-4000-8000-000000000000";
const DUMMY_TIMESTAMP = "1970-01-01T00:00:00Z";

export const DECISION_ALLOWED_ACTIONS = [
  "WINDOW_ACTIVATE",
  "TAKE_SCREENSHOT",
  "CLIPBOARD_SET_TEXT",
  "INPUT_KEY_CHORD",
  "MOUSE_MOVE",
  "MOUSE_CLICK",
  "MOUSE_DRAG",
  "MOUSE_SCROLL",
  "DESKTOP_INSPECT_TREE",
] as const;

export type DecisionAllowedAction = (typeof DECISION_ALLOWED_ACTIONS)[number];

// Defense-in-depth: even inside an allowlisted action, the proposal text must not steer
// toward the prohibited behaviours (payment, transfer, order confirmation, captcha/shell).
const PROHIBITED_PROPOSAL_PATTERNS = [
  /(?:点击|确认|执行|完成).{0,12}(?:支付|付款|转账|下单|红包)/u,
  /(?:绕过|破解|自动识别).{0,8}(?:验证码|风控|登录保护)/u,
  /\brun\b|\bshell\b|\bscript\b|powershell|cmd\.exe/iu,
] as const;

export interface ValidatedProposal {
  action: string;
  arguments: Record<string, unknown>;
}

export type ProposalValidationResult =
  | { status: "accepted"; proposal: ValidatedProposal }
  | { status: "rejected"; code: "PROPOSAL_REJECTED" };

export interface ProposalValidationOptions {
  allowlistedProcessNames: ReadonlySet<string>;
}

function resolveProcessName(action: string, args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) {
    return undefined;
  }
  if (action === "DESKTOP_INSPECT_TREE" || action === "WINDOW_ACTIVATE") {
    const processName = (args as { processName?: unknown }).processName;
    return typeof processName === "string" ? processName : undefined;
  }
  const target = (args as { target?: unknown }).target;
  if (typeof target === "object" && target !== null) {
    const processName = (target as { processName?: unknown }).processName;
    return typeof processName === "string" ? processName : undefined;
  }
  return undefined;
}

/**
 * Validates an LLM proposal through the five stages. Returns the narrowed action and
 * arguments on acceptance, or a single stable `PROPOSAL_REJECTED` on any failure. The
 * rejection reason is logged by the caller; the model is never told how to "fix" itself.
 */
export function validateProposal(
  proposal: unknown,
  options: ProposalValidationOptions,
): ProposalValidationResult {
  if (
    typeof proposal !== "object" ||
    proposal === null ||
    !("action" in proposal) ||
    !("arguments" in proposal) ||
    typeof (proposal as { action: unknown }).action !== "string" ||
    typeof (proposal as { arguments: unknown }).arguments !== "object" ||
    (proposal as { arguments: unknown }).arguments === null
  ) {
    return { status: "rejected", code: "PROPOSAL_REJECTED" };
  }

  const { action, arguments: args } = proposal as {
    action: string;
    arguments: Record<string, unknown>;
  };

  // Stage 2: narrowed action allowlist.
  if (!DECISION_ALLOWED_ACTIONS.includes(action as DecisionAllowedAction)) {
    return { status: "rejected", code: "PROPOSAL_REJECTED" };
  }

  // Stage 3: argument range — the proposal must form a valid desktop.command for its action.
  const candidate = {
    payload: {
      action,
      arguments: args,
      commandId: DUMMY_UUID,
      expiresAt: DUMMY_TIMESTAMP,
      taskId: DUMMY_UUID,
    },
    schemaVersion: SCHEMA_VERSION,
    messageId: DUMMY_UUID,
    timestamp: DUMMY_TIMESTAMP,
    type: "desktop.command",
  };
  if (!isSchemaValue(DesktopCommandSchema, candidate)) {
    return { status: "rejected", code: "PROPOSAL_REJECTED" };
  }

  // Stage 4: policy — no prohibited behaviour may appear in the proposal text.
  const scanned = JSON.stringify({
    ...args,
    reasoning: (proposal as { reasoning?: unknown }).reasoning ?? "",
    expectedOutcome: (proposal as { expectedOutcome?: unknown }).expectedOutcome ?? "",
  });
  if (PROHIBITED_PROPOSAL_PATTERNS.some((pattern) => pattern.test(scanned))) {
    return { status: "rejected", code: "PROPOSAL_REJECTED" };
  }

  // Stage 5: target allowlist — a process-targeting action must name an allowlisted window.
  const processName = resolveProcessName(action, args);
  if (
    processName !== undefined &&
    !options.allowlistedProcessNames.has(processName.toLowerCase())
  ) {
    return { status: "rejected", code: "PROPOSAL_REJECTED" };
  }

  return { status: "accepted", proposal: { action, arguments: args } };
}

import type { CommandRejectionCode } from "./ai-question-command.js";

/**
 * Reasons that are answered back to the sender. A message that carried the command prefix but
 * could not be turned into work is a user error the sender can correct, so it must not be
 * dropped in silence.
 *
 * `UNTRUSTED_SENDER` and `COMMAND_PREFIX_MISSING` are deliberately absent: answering an unknown
 * account confirms the bot to strangers, and answering unprefixed text would inject replies into
 * ordinary conversation. Both are dropped silently, as `docs/10-user-manual.md` documents.
 */
const NOTICE_REASONS: ReadonlySet<CommandRejectionCode> = new Set([
  "COMMAND_UNSUPPORTED",
  "INVALID_ARGUMENTS",
  "POLICY_DENIED",
]);

const POLICY_DENIED_NOTICE =
  "该指令包含本助手不支持的操作（如支付、转账、下单、获取账号凭据、绕过验证码），已被安全策略拒绝。本助手只做查询、比较与推荐，不会代替你付款或下单。";

function usageNotice(commandPrefix: string): string {
  return [
    "无法识别该指令。当前只支持两种指令：",
    `1. 提问：${commandPrefix} 问AI：<问题>`,
    `2. 比价：${commandPrefix} 搜索 <关键词> <最高预算>元以内，选<1-3>款，优先<偏好>`,
    `例如：${commandPrefix} 搜索 300元以内的无线鼠标，选3款，优先静音`,
  ].join("\n");
}

/**
 * Returns the reply text for a rejected command, or `null` when the message must be dropped
 * silently. Pure function: wording and the reply/silence decision are unit-testable without a
 * transport.
 */
export function buildCommandNotice(
  reason: CommandRejectionCode,
  commandPrefix: string,
): string | null {
  if (!NOTICE_REASONS.has(reason)) {
    return null;
  }
  if (reason === "POLICY_DENIED") {
    return POLICY_DENIED_NOTICE;
  }
  return usageNotice(commandPrefix);
}

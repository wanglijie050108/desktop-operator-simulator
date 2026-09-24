export type CommandRejectionCode =
  | "UNTRUSTED_SENDER"
  | "COMMAND_PREFIX_MISSING"
  | "COMMAND_UNSUPPORTED"
  | "POLICY_DENIED"
  | "INVALID_ARGUMENTS";

export type AiQuestionCommandDecision =
  { accepted: true; question: string } | { accepted: false; code: CommandRejectionCode };

const PROHIBITED_ACTION_PATTERNS = [
  /(?:点击|确认|执行|完成).{0,12}(?:支付|付款|转账|下单|红包)/iu,
  /下单|发红包/iu,
  /(?:运行|执行|打开).{0,8}(?:shell|脚本|命令行|cmd|powershell)/iu,
  /(?:导出|读取|发送|获取).{0,8}(?:cookie|密码|凭据|token)/iu,
  /(?:绕过|破解|自动识别).{0,8}(?:验证码|风控|登录保护)/iu,
  /\b(?:click|confirm|submit|approve|make)\s+(?:the\s+)?(?:payment|pay(?:ment)?|transfer|checkout)\b/iu,
  /\bplace\s+(?:an?\s+)?order\b/iu,
  /\b(?:run|execute)\s+(?:a\s+)?(?:command|script|shell|cmd|powershell)\b/iu,
  /\b(?:send|export|read|extract|steal)\s+(?:me\s+)?(?:the\s+)?(?:cookies?|credentials?|passwords?|tokens?)\b/iu,
  /\b(?:bypass|defeat|solve)\s+(?:the\s+)?(?:captcha|verification|2fa|security)\b/iu,
] as const;

export interface AiQuestionCommandPolicyOptions {
  commandPrefix: string;
  isTrustedSender: (senderId: string) => boolean;
}

export class AiQuestionCommandPolicy {
  public constructor(private readonly options: AiQuestionCommandPolicyOptions) {
    if (options.commandPrefix.trim().length === 0) {
      throw new Error("Command prefix must not be empty");
    }
  }

  public evaluate(senderId: string, content: string): AiQuestionCommandDecision {
    if (!this.options.isTrustedSender(senderId)) {
      return { accepted: false, code: "UNTRUSTED_SENDER" };
    }

    const normalizedContent = content.trim();
    if (!normalizedContent.startsWith(this.options.commandPrefix)) {
      return { accepted: false, code: "COMMAND_PREFIX_MISSING" };
    }

    const command = normalizedContent.slice(this.options.commandPrefix.length).trim();
    if (PROHIBITED_ACTION_PATTERNS.some((pattern) => pattern.test(command))) {
      return { accepted: false, code: "POLICY_DENIED" };
    }

    const match = /^(?:问\s*AI|问AI)\s*[：:]\s*(.+)$/iu.exec(command);
    if (match === null) {
      return { accepted: false, code: "COMMAND_UNSUPPORTED" };
    }

    const question = match[1]?.trim() ?? "";
    if (question.length === 0 || question.length > 2_000) {
      return { accepted: false, code: "INVALID_ARGUMENTS" };
    }

    return { accepted: true, question };
  }
}

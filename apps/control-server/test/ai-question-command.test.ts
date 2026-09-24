import { describe, expect, it } from "vitest";

import { AiQuestionCommandPolicy } from "../src/domain/ai-question-command.js";

function policy(): AiQuestionCommandPolicy {
  return new AiQuestionCommandPolicy({
    commandPrefix: "#助手",
    isTrustedSender: (senderId) => senderId === "trusted-sender",
  });
}

describe("AI question command policy", () => {
  it("accepts a trusted, prefixed AI question", () => {
    expect(policy().evaluate("trusted-sender", " #助手 问AI：解释零信任网络 ")).toStrictEqual({
      accepted: true,
      question: "解释零信任网络",
    });
  });

  it.each([
    ["unknown-sender", "#助手 问AI：test", "UNTRUSTED_SENDER"],
    ["trusted-sender", "普通聊天", "COMMAND_PREFIX_MISSING"],
    ["trusted-sender", "#助手 搜索鼠标", "COMMAND_UNSUPPORTED"],
    ["trusted-sender", "#助手 问AI：", "COMMAND_UNSUPPORTED"],
    ["trusted-sender", "#助手 点击付款", "POLICY_DENIED"],
    ["trusted-sender", "#助手 执行 PowerShell 命令", "POLICY_DENIED"],
    ["trusted-sender", "#助手 获取浏览器 Cookie", "POLICY_DENIED"],
    ["trusted-sender", "#助手 自动识别验证码", "POLICY_DENIED"],
  ])("rejects disallowed input", (senderId, content, code) => {
    expect(policy().evaluate(senderId, content)).toStrictEqual({
      accepted: false,
      code,
    });
  });

  it("rejects questions above the contract length limit", () => {
    expect(policy().evaluate("trusted-sender", `#助手 问AI：${"a".repeat(2_001)}`)).toStrictEqual({
      accepted: false,
      code: "INVALID_ARGUMENTS",
    });
  });
});

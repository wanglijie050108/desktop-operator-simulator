import { describe, expect, it } from "vitest";

import { buildCommandNotice } from "../src/domain/command-notice.js";

describe("buildCommandNotice", () => {
  it("answers an unsupported prefixed command with the supported command forms", () => {
    const notice = buildCommandNotice("COMMAND_UNSUPPORTED", "#助手");

    expect(notice).not.toBeNull();
    expect(notice).toContain("#助手 问AI：");
    expect(notice).toContain("#助手 搜索");
  });

  it("answers invalid arguments with the same usage guidance", () => {
    expect(buildCommandNotice("INVALID_ARGUMENTS", "#助手")).toContain("#助手 问AI：");
  });

  it("interpolates the configured command prefix", () => {
    const notice = buildCommandNotice("COMMAND_UNSUPPORTED", "!!bot");

    expect(notice).toContain("!!bot 问AI：");
    expect(notice).not.toContain("#助手");
  });

  it("states that prohibited operations are refused rather than executed", () => {
    const notice = buildCommandNotice("POLICY_DENIED", "#助手");

    expect(notice).toContain("安全策略拒绝");
    expect(notice).toContain("不会代替你付款或下单");
  });

  it("stays silent for unprefixed chat so ordinary conversation is not answered", () => {
    expect(buildCommandNotice("COMMAND_PREFIX_MISSING", "#助手")).toBeNull();
  });

  it("stays silent for untrusted senders so the bot is not confirmed to strangers", () => {
    expect(buildCommandNotice("UNTRUSTED_SENDER", "#助手")).toBeNull();
  });
});

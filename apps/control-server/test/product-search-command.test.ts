import { describe, expect, it } from "vitest";

import { parseProductSearchCommand } from "../src/domain/product-search-command.js";

describe("product search command parser", () => {
  it.each([
    [
      "#助手 搜索 300元以内的无线鼠标，选3款，优先静音和办公",
      {
        candidateCount: 3,
        maxPrice: 300,
        preferences: ["静音", "办公"],
        query: "无线鼠标",
      },
    ],
    [
      "#助手 查找 机械键盘，预算为499.50元，推荐二款，偏好无线、热插拔",
      {
        candidateCount: 2,
        maxPrice: 499.5,
        preferences: ["无线", "热插拔"],
        query: "机械键盘",
      },
    ],
  ])("parses a complete shopping command", (content, request) => {
    expect(parseProductSearchCommand(content, "#助手")).toStrictEqual({
      accepted: true,
      request,
    });
  });

  it("identifies all missing required fields", () => {
    expect(parseProductSearchCommand("#助手 搜索", "#助手")).toStrictEqual({
      accepted: false,
      code: "INVALID_ARGUMENTS",
      missingFields: ["query", "maxPrice", "candidateCount"],
    });
    expect(parseProductSearchCommand("#助手 搜索 无线鼠标", "#助手")).toStrictEqual({
      accepted: false,
      code: "INVALID_ARGUMENTS",
      missingFields: ["maxPrice", "candidateCount"],
    });
  });

  it.each([
    ["#助手 问AI：解释零信任网络", "COMMAND_UNSUPPORTED"],
    ["普通聊天", "COMMAND_UNSUPPORTED"],
    ["#助手 搜索 0元以内的鼠标，选3款", "INVALID_ARGUMENTS"],
    ["#助手 搜索 300元以内的鼠标，选4款", "INVALID_ARGUMENTS"],
  ])("rejects unsupported or invalid input", (content, code) => {
    expect(parseProductSearchCommand(content, "#助手")).toMatchObject({
      accepted: false,
      code,
    });
  });
});

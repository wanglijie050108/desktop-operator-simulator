import { describe, expect, it } from "vitest";

import { redactError, redactText, redactValue } from "../src/domain/redaction.js";

describe("redactText", () => {
  it("masks long digit sequences while keeping the last four digits", () => {
    expect(redactText("call 13812345678 now")).toBe("call ***-***-5678 now");
    expect(redactText("card 6222021234567890 used")).toBe("card ***-***-7890 used");
  });

  it("leaves short numbers untouched", () => {
    expect(redactText("price 12345 and count 42")).toBe("price 12345 and count 42");
  });

  it("masks email local parts", () => {
    expect(redactText("account test.user@example.com signed in")).toBe(
      "account [REDACTED]@example.com signed in",
    );
  });

  it("masks URL credentials", () => {
    expect(redactText("visit https://admin:secret@example.com/path")).toBe(
      "visit https://[REDACTED]@example.com/path",
    );
  });

  it("masks secret assignments", () => {
    expect(redactText("token=abc.def-ghi end")).toBe("token=[REDACTED] end");
    expect(redactText("密钥=abc123 完成")).toBe("密钥=[REDACTED] 完成");
  });

  it("leaves plain text untouched", () => {
    expect(redactText("任务完成，耗时 320ms")).toBe("任务完成，耗时 320ms");
  });
});

describe("redactValue", () => {
  it("masks values attached to sensitive keys", () => {
    const result = redactValue({ password: "hunter2", name: "agent-1" });
    expect(result).toEqual({ password: "[REDACTED]", name: "agent-1" });
  });

  it("recurses into arrays and nested objects", () => {
    const result = redactValue([{ token: "abc", nested: { text: "call 13812345678" } }]);
    expect(result).toEqual([{ token: "[REDACTED]", nested: { text: "call ***-***-5678" } }]);
  });

  it("keeps primitives other than strings unchanged", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBe(null);
  });
});

describe("redactError", () => {
  it("redacts error messages", () => {
    expect(redactError(new Error("failed for 13812345678"))).toEqual({
      message: "failed for ***-***-5678",
      name: "Error",
    });
  });

  it("handles non-error throwables", () => {
    expect(redactError("string failure")).toEqual({
      message: "string failure",
      name: "Unknown",
    });
  });
});

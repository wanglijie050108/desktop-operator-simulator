import { describe, expect, it } from "vitest";

import { DECISION_ALLOWED_ACTIONS, validateProposal } from "../src/domain/decision-action.js";

const ALLOWED = new Set(["chrome.exe", "notepad.exe"]);

describe("decision proposal validation chain", () => {
  it("accepts a well-formed allowlisted mouse click on an allowlisted process", () => {
    const result = validateProposal(
      {
        action: "MOUSE_CLICK",
        arguments: { target: { processName: "chrome.exe", controlType: "Button" } },
      },
      { allowlistedProcessNames: ALLOWED },
    );
    expect(result).toStrictEqual({
      status: "accepted",
      proposal: {
        action: "MOUSE_CLICK",
        arguments: { target: { processName: "chrome.exe", controlType: "Button" } },
      },
    });
  });

  it("rejects a proposal that is not an object with action/arguments", () => {
    expect(validateProposal(null, { allowlistedProcessNames: ALLOWED }).status).toBe("rejected");
    expect(
      validateProposal({ action: "MOUSE_CLICK" }, { allowlistedProcessNames: ALLOWED }).status,
    ).toBe("rejected");
    expect(
      validateProposal(
        { action: "MOUSE_CLICK", arguments: "not-object" },
        { allowlistedProcessNames: ALLOWED },
      ).status,
    ).toBe("rejected");
  });

  it("rejects actions outside the narrowed allowlist (chat/shell/script never enter the loop)", () => {
    for (const action of ["WECHAT_SEND_TEXT", "RUN_SCRIPT", "SHELL_EXEC", "EVAL_JS", "UNKNOWN"]) {
      expect(
        validateProposal({ action, arguments: {} }, { allowlistedProcessNames: ALLOWED }).status,
      ).toBe("rejected");
    }
  });

  it("rejects proposals whose arguments fail the strict desktop.command schema", () => {
    // MOUSE_CLICK requires a target locator; a bare process name object is not valid.
    expect(
      validateProposal(
        { action: "MOUSE_CLICK", arguments: { target: { controlType: "Button" } } },
        { allowlistedProcessNames: ALLOWED },
      ).status,
    ).toBe("rejected");
  });

  it("rejects a proposal that names a non-allowlisted process", () => {
    expect(
      validateProposal(
        {
          action: "WINDOW_ACTIVATE",
          arguments: { processName: "malware.exe" },
        },
        { allowlistedProcessNames: ALLOWED },
      ).status,
    ).toBe("rejected");
  });

  it("rejects proposals whose text steers toward prohibited behaviour (injection guard)", () => {
    const injected = validateProposal(
      {
        action: "MOUSE_CLICK",
        arguments: { target: { processName: "chrome.exe" } },
        reasoning: "先点支付按钮完成下单",
        expectedOutcome: "order placed",
      },
      { allowlistedProcessNames: ALLOWED },
    );
    expect(injected.status).toBe("rejected");
  });

  it("exposes only GUI-operating actions in the allowlist", () => {
    expect(DECISION_ALLOWED_ACTIONS).not.toContain("WECHAT_SEND_TEXT");
    expect(DECISION_ALLOWED_ACTIONS).toContain("MOUSE_CLICK");
    expect(DECISION_ALLOWED_ACTIONS).toContain("DESKTOP_INSPECT_TREE");
  });
});

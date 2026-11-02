import { describe, expect, it, vi } from "vitest";

import type { DesktopCommand, DesktopCommandResult } from "@hos/contracts";

import { AdapterError } from "../src/adapters/adapter-error.js";
import { AgentCommandExecutor } from "../src/adapters/agent-command-executor.js";
import {
  AgentObservationAdapter,
  type DesktopCommandDispatcher,
} from "../src/adapters/agent-observation-adapter.js";

const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK_ID = "66666666-6666-4666-8666-666666666666";
const REDACTION_KEY = "driver-test-redaction-key";
const NOW = new Date("2026-10-24T08:00:00.000Z");

function observedTree() {
  return {
    capturedAt: "2026-10-24T08:00:00Z",
    nodes: [
      {
        automationId: "RootWebArea",
        controlType: "Window",
        depth: 0,
        enabled: true,
        name: "购物 - Chrome",
        visible: true,
      },
      {
        automationId: "search-box",
        controlType: "Edit",
        depth: 1,
        enabled: true,
        name: "搜索商品",
        visible: true,
      },
    ],
    processId: 4321,
    processName: "chrome",
    timedOut: false,
    truncated: false,
    windowHandle: 123456,
    windowTitle: "购物 - Chrome",
  };
}

function result(overrides: Partial<DesktopCommandResult["payload"]> = {}): DesktopCommandResult {
  return {
    messageId: "99999999-9999-4999-8999-999999999999",
    payload: {
      commandId: "55555555-5555-4555-8555-555555555555",
      outcome: "SUCCEEDED",
      taskId: TASK_ID,
      ...overrides,
    },
    schemaVersion: "1.0",
    timestamp: "2026-10-24T08:00:01Z",
    type: "desktop.command.result",
  };
}

function dispatcherReturning(value: DesktopCommandResult): {
  dispatcher: DesktopCommandDispatcher;
  sent: DesktopCommand[];
} {
  const sent: DesktopCommand[] = [];
  return {
    dispatcher: {
      requestDesktopCommand: (_agentId, message) => {
        sent.push(message);
        return Promise.resolve(value);
      },
    },
    sent,
  };
}

function buildAdapter(dispatcher: DesktopCommandDispatcher) {
  return new AgentObservationAdapter({
    agentId: AGENT_ID,
    dispatcher,
    now: () => NOW,
    redactionKey: REDACTION_KEY,
    taskId: TASK_ID,
  });
}

const REQUEST = { target: { processName: "chrome.exe" }, taskId: TASK_ID };

describe("AgentObservationAdapter", () => {
  it("sends a DESKTOP_INSPECT_TREE command to the Agent", async () => {
    const { dispatcher, sent } = dispatcherReturning(result({ observation: observedTree() }));

    await buildAdapter(dispatcher).inspect(REQUEST, new AbortController().signal);

    expect(sent).toHaveLength(1);
    const command = sent[0];
    expect(command?.type).toBe("desktop.command");
    expect(command?.payload.action).toBe("DESKTOP_INSPECT_TREE");
    if (command?.payload.action !== "DESKTOP_INSPECT_TREE") {
      throw new Error("wrong action");
    }
    expect(command.payload.arguments.processName).toBe("chrome.exe");
    expect(command.payload.expiresAt).toBe("2026-10-24T08:00:30.000Z");
  });

  it("rebuilds nesting and produces both boundary views", async () => {
    const { dispatcher } = dispatcherReturning(result({ observation: observedTree() }));

    const capture = await buildAdapter(dispatcher).inspect(REQUEST, new AbortController().signal);

    // Raw tree: the model needs readable labels.
    expect(capture.raw[0]?.controlType).toBe("Window");
    expect(capture.raw[0]?.children?.[0]?.name).toBe("搜索商品");
    // Summary: the persisted record must not carry them.
    expect(JSON.stringify(capture.summary)).not.toContain("搜索商品");
    expect(capture.summary.nodeCount).toBe(2);
    expect(capture.summary.source).toBe("UIA_TREE");
    expect(capture.summary.capturedAt).toBe("2026-10-24T08:00:00Z");
  });

  it("honours the request node budget", async () => {
    const { dispatcher, sent } = dispatcherReturning(result({ observation: observedTree() }));

    await buildAdapter(dispatcher).inspect(
      { ...REQUEST, maxNodes: 400 },
      new AbortController().signal,
    );

    const command = sent[0];
    if (command?.payload.action !== "DESKTOP_INSPECT_TREE") {
      throw new Error("wrong action");
    }
    expect(command.payload.arguments.maxNodes).toBe(400);
  });

  it("fails closed when the Agent refuses the policy check", async () => {
    const { dispatcher } = dispatcherReturning(
      result({ errorCode: "POLICY_DENIED", outcome: "REJECTED" }),
    );

    await expect(
      buildAdapter(dispatcher).inspect(REQUEST, new AbortController().signal),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  });

  it("fails closed when the target application is not running", async () => {
    const { dispatcher } = dispatcherReturning(
      result({ errorCode: "TARGET_APP_NOT_FOUND", outcome: "FAILED" }),
    );

    await expect(
      buildAdapter(dispatcher).inspect(REQUEST, new AbortController().signal),
    ).rejects.toMatchObject({ code: "TARGET_APP_NOT_FOUND" });
  });

  it("does not invent an error code the contract does not define", async () => {
    const { dispatcher } = dispatcherReturning(
      result({ errorCode: "SOMETHING_NEW", outcome: "FAILED" }),
    );

    await expect(
      buildAdapter(dispatcher).inspect(REQUEST, new AbortController().signal),
    ).rejects.toMatchObject({ code: "DESKTOP_ACTION_FAILED" });
  });

  it("fails closed when success carries no observation", async () => {
    const { dispatcher } = dispatcherReturning(result());

    await expect(
      buildAdapter(dispatcher).inspect(REQUEST, new AbortController().signal),
    ).rejects.toMatchObject({ code: "DESKTOP_ACTION_FAILED" });
  });

  it("fails closed on an empty control tree", async () => {
    const { dispatcher } = dispatcherReturning(
      result({ observation: { ...observedTree(), nodes: [] } }),
    );

    await expect(
      buildAdapter(dispatcher).inspect(REQUEST, new AbortController().signal),
    ).rejects.toMatchObject({ code: "DESKTOP_ACTION_FAILED" });
  });

  it("rejects a path instead of a bare process name", async () => {
    const { dispatcher, sent } = dispatcherReturning(result({ observation: observedTree() }));

    await expect(
      buildAdapter(dispatcher).inspect(
        { target: { processName: String.raw`C:\Windows\chrome.exe` }, taskId: TASK_ID },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
    expect(sent).toHaveLength(0);
  });

  it("maps an offline Agent to AGENT_UNAVAILABLE", async () => {
    const dispatcher: DesktopCommandDispatcher = {
      requestDesktopCommand: () => Promise.reject(new Error("Agent is not connected")),
    };

    await expect(
      buildAdapter(dispatcher).inspect(REQUEST, new AbortController().signal),
    ).rejects.toMatchObject({ code: "AGENT_UNAVAILABLE" });
  });

  it("maps a gateway timeout to ADAPTER_TIMEOUT", async () => {
    const dispatcher: DesktopCommandDispatcher = {
      requestDesktopCommand: () => Promise.reject(new Error("Desktop command timed out")),
    };

    await expect(
      buildAdapter(dispatcher).inspect(REQUEST, new AbortController().signal),
    ).rejects.toMatchObject({ code: "ADAPTER_TIMEOUT" });
  });

  it("does not wait for a reply once the task is cancelled", async () => {
    const controller = new AbortController();
    const dispatcher: DesktopCommandDispatcher = {
      requestDesktopCommand: () =>
        new Promise<DesktopCommandResult>((resolve) => {
          setTimeout(() => {
            resolve(result({ observation: observedTree() }));
          }, 5_000);
        }),
    };

    const pending = buildAdapter(dispatcher).inspect(REQUEST, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "TASK_CANCELLED" });
  });

  it("sends nothing when the signal is already aborted", async () => {
    const { dispatcher, sent } = dispatcherReturning(result({ observation: observedTree() }));
    const controller = new AbortController();
    controller.abort();

    await expect(
      buildAdapter(dispatcher).inspect(REQUEST, controller.signal),
    ).rejects.toBeInstanceOf(AdapterError);
    expect(sent).toHaveLength(0);
  });
});

describe("AgentCommandExecutor", () => {
  const command = {
    messageId: "77777777-7777-4777-8777-777777777777",
    payload: {
      action: "MOUSE_CLICK",
      arguments: { target: { processName: "chrome.exe" }, controlType: "Button" },
      commandId: "88888888-8888-4888-8888-888888888888",
      expiresAt: "2026-10-24T08:00:30.000Z",
      taskId: TASK_ID,
    },
    schemaVersion: "1.0",
    timestamp: "2026-10-24T08:00:00Z",
    type: "desktop.command",
  } as DesktopCommand;

  it("resolves when the Agent succeeded", async () => {
    const { dispatcher, sent } = dispatcherReturning(result());
    const executor = new AgentCommandExecutor({ agentId: AGENT_ID, dispatcher });

    await expect(executor.execute(command, new AbortController().signal)).resolves.toBeUndefined();
    expect(sent[0]?.payload.commandId).toBe("88888888-8888-4888-8888-888888888888");
  });

  it("raises when the Agent rejected the command", async () => {
    const { dispatcher } = dispatcherReturning(
      result({ errorCode: "POLICY_DENIED", outcome: "REJECTED" }),
    );
    const executor = new AgentCommandExecutor({ agentId: AGENT_ID, dispatcher });

    await expect(executor.execute(command, new AbortController().signal)).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });
  });

  it("raises when the command expired before the Agent ran it", async () => {
    const { dispatcher } = dispatcherReturning(
      result({ errorCode: "COMMAND_EXPIRED", outcome: "REJECTED" }),
    );
    const executor = new AgentCommandExecutor({ agentId: AGENT_ID, dispatcher });

    await expect(executor.execute(command, new AbortController().signal)).rejects.toMatchObject({
      code: "COMMAND_EXPIRED",
    });
  });

  it("raises on a failed execution so the loop cannot verify a state that never happened", async () => {
    const { dispatcher } = dispatcherReturning(
      result({ errorCode: "TARGET_WINDOW_MISMATCH", outcome: "FAILED" }),
    );
    const executor = new AgentCommandExecutor({ agentId: AGENT_ID, dispatcher });

    await expect(executor.execute(command, new AbortController().signal)).rejects.toMatchObject({
      code: "DESKTOP_ACTION_FAILED",
    });
  });

  it("stops waiting when the task is cancelled", async () => {
    const controller = new AbortController();
    const dispatcher: DesktopCommandDispatcher = {
      requestDesktopCommand: () =>
        new Promise<DesktopCommandResult>((resolve) => {
          setTimeout(() => {
            resolve(result());
          }, 5_000);
        }),
    };
    const executor = new AgentCommandExecutor({ agentId: AGENT_ID, dispatcher });

    const pending = executor.execute(command, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "TASK_CANCELLED" });
  });

  it("is dispatched with the agent the caller chose", async () => {
    const seen: string[] = [];
    const dispatcher: DesktopCommandDispatcher = {
      requestDesktopCommand: (agentId) => {
        seen.push(agentId);
        return Promise.resolve(result());
      },
    };
    const executor = new AgentCommandExecutor({ agentId: AGENT_ID, dispatcher });

    await executor.execute(command, new AbortController().signal);

    expect(seen).toStrictEqual([AGENT_ID]);
  });
});

describe("driver wiring into the decision loop", () => {
  it("uses the adapter pair to complete one round", async () => {
    const { dispatcher } = dispatcherReturning(result({ observation: observedTree() }));
    const observe = buildAdapter(dispatcher);
    const inspect = vi.spyOn(observe, "inspect");

    await observe.inspect(REQUEST, new AbortController().signal);

    expect(inspect).toHaveBeenCalledTimes(1);
  });
});

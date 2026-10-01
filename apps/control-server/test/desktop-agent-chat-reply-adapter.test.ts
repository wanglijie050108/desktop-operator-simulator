import type { DesktopCommand, DesktopCommandResult } from "@hos/contracts";
import { describe, expect, it } from "vitest";

import { DesktopAgentChatReplyAdapter } from "../src/adapters/desktop-agent-chat-reply-adapter.js";
import type { ChatReplyRequest } from "../src/adapters/chat-reply-adapter.js";
import type { AgentGateway } from "../src/application/agent-gateway.js";

interface FakeGatewayOverrides {
  pickWeChatSendAgent?: () => string | null;
  requestDesktopCommand?: (
    agentId: string,
    command: DesktopCommand,
  ) => Promise<DesktopCommandResult>;
}

function fakeGateway(overrides: FakeGatewayOverrides): AgentGateway {
  return {
    pickWeChatSendAgent: overrides.pickWeChatSendAgent ?? (() => null),
    requestDesktopCommand:
      overrides.requestDesktopCommand ??
      (() => Promise.reject(new Error("requestDesktopCommand unset"))),
  } as unknown as AgentGateway;
}

function succeededResult(command: DesktopCommand): DesktopCommandResult {
  return {
    schemaVersion: "1.0",
    type: "desktop.command.result",
    messageId: "77777777-7777-4777-8777-777777777777",
    timestamp: "2026-09-24T04:01:01Z",
    payload: {
      commandId: command.payload.commandId,
      taskId: command.payload.taskId,
      outcome: "SUCCEEDED",
    },
  };
}

function request(): ChatReplyRequest {
  return {
    conversationId: "conversation-hash",
    signal: new AbortController().signal,
    taskId: "66666666-6666-4666-8666-666666666666",
    text: "测试答案",
  };
}

describe("DesktopAgentChatReplyAdapter", () => {
  it("rejects when no agent declared wechat.send", async () => {
    const adapter = new DesktopAgentChatReplyAdapter(
      fakeGateway({ pickWeChatSendAgent: () => null }),
    );

    await expect(adapter.send(request())).rejects.toMatchObject({ code: "AGENT_UNAVAILABLE" });
  });

  it("sends WECHAT_SEND_TEXT to the chosen agent and resolves on SUCCEEDED", async () => {
    let capturedAgentId: string | null = null;
    let capturedAction: string | null = null;
    let capturedArguments: { conversationId: string; text: string } | null = null;
    const adapter = new DesktopAgentChatReplyAdapter(
      fakeGateway({
        pickWeChatSendAgent: () => "agent-1",
        requestDesktopCommand: (agentId, command) => {
          capturedAgentId = agentId;
          capturedAction = command.payload.action;
          if (command.payload.action === "WECHAT_SEND_TEXT") {
            capturedArguments = command.payload.arguments;
          }
          return Promise.resolve(succeededResult(command));
        },
      }),
    );

    await expect(adapter.send(request())).resolves.toBeUndefined();
    expect(capturedAgentId).toBe("agent-1");
    expect(capturedAction).toBe("WECHAT_SEND_TEXT");
    expect(capturedArguments).toEqual({
      conversationId: "conversation-hash",
      text: "测试答案",
    });
  });

  it("rejects when the desktop command is not SUCCEEDED", async () => {
    const adapter = new DesktopAgentChatReplyAdapter(
      fakeGateway({
        pickWeChatSendAgent: () => "agent-1",
        requestDesktopCommand: (_agentId, command) =>
          Promise.resolve({
            schemaVersion: "1.0",
            type: "desktop.command.result",
            messageId: "77777777-7777-4777-8777-777777777777",
            timestamp: "2026-09-24T04:01:01Z",
            payload: {
              commandId: command.payload.commandId,
              taskId: command.payload.taskId,
              outcome: "REJECTED",
              errorCode: "POLICY_DENIED",
            },
          }),
      }),
    );

    await expect(adapter.send(request())).rejects.toMatchObject({ code: "DESKTOP_ACTION_FAILED" });
  });

  it("rejects when the desktop agent does not respond", async () => {
    const adapter = new DesktopAgentChatReplyAdapter(
      fakeGateway({
        pickWeChatSendAgent: () => "agent-1",
        requestDesktopCommand: () => Promise.reject(new Error("Desktop command timed out")),
      }),
    );

    await expect(adapter.send(request())).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("rejects before dispatch when the request is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = new DesktopAgentChatReplyAdapter(
      fakeGateway({ pickWeChatSendAgent: () => "agent-1" }),
    );

    await expect(adapter.send({ ...request(), signal: controller.signal })).rejects.toMatchObject({
      code: "REPLY_ABORTED",
    });
  });
});

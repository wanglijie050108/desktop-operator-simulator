import { randomUUID } from "node:crypto";

import { SCHEMA_VERSION, type DesktopCommand } from "@hos/contracts";

import { AdapterError } from "./adapter-error.js";
import type { ChatReplyAdapter, ChatReplyRequest } from "./chat-reply-adapter.js";
import type { AgentGateway } from "../application/agent-gateway.js";

interface DesktopAgentChatReplyAdapterOptions {
  replyExpiresInMs?: number;
}

/**
 * Bridges workflow chat replies to a connected Desktop Agent that owns the WeChat window.
 *
 * The adapter is fail-closed: if no agent has declared `wechat.send` it rejects, and a non-SUCCEEDED
 * desktop command result is surfaced as an adapter error. The workflow that calls `send` already
 * handles `AdapterError`, so a missing or unavailable desktop agent degrades gracefully.
 */
export class DesktopAgentChatReplyAdapter implements ChatReplyAdapter {
  private readonly replyExpiresInMs: number;

  public constructor(
    private readonly gateway: AgentGateway,
    options: DesktopAgentChatReplyAdapterOptions = {},
  ) {
    this.replyExpiresInMs = options.replyExpiresInMs ?? 60_000;
  }

  public async send(request: ChatReplyRequest): Promise<void> {
    if (request.signal.aborted) {
      throw new AdapterError("REPLY_ABORTED", "Chat reply was aborted before dispatch");
    }

    const agentId = this.gateway.pickWeChatSendAgent();
    if (agentId === null) {
      throw new AdapterError(
        "AGENT_UNAVAILABLE",
        "No connected agent declared the wechat.send capability",
      );
    }

    const command: DesktopCommand = {
      schemaVersion: SCHEMA_VERSION,
      type: "desktop.command",
      messageId: randomUUID(),
      timestamp: new Date().toISOString(),
      payload: {
        commandId: randomUUID(),
        // The protocol requires a correlation id even for a task-less notice, so one is minted
        // here instead of inventing a task id at the call site.
        taskId: request.taskId ?? randomUUID(),
        expiresAt: new Date(Date.now() + this.replyExpiresInMs).toISOString(),
        action: "WECHAT_SEND_TEXT",
        arguments: { conversationId: request.conversationId, text: request.text },
      },
    };

    try {
      const result = await this.gateway.requestDesktopCommand(agentId, command);
      if (result.payload.outcome !== "SUCCEEDED") {
        throw new AdapterError(
          "DESKTOP_ACTION_FAILED",
          `WeChat send command failed: ${result.payload.errorCode ?? "unknown error"}`,
        );
      }
    } catch (error) {
      if (error instanceof AdapterError) {
        throw error;
      }
      throw new AdapterError("SERVICE_UNAVAILABLE", "Desktop agent did not respond");
    }
  }
}

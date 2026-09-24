import { randomUUID } from "node:crypto";

import {
  AgentToServerMessageSchema,
  isSchemaValue,
  SCHEMA_VERSION,
  type AgentCapability,
  type AgentHello,
  type AgentToServerMessage,
  type ChatMessageReceived,
  type DesktopCommand,
  type EmergencyStop,
  type ProtocolError,
  type ServerToAgentMessage,
  type ServerWelcome,
  type TaskCancel,
} from "@hos/contracts";
import type { FastifyBaseLogger } from "fastify";
import WebSocket, { type RawData } from "ws";

import type { AgentRepository } from "../infrastructure/database/agent-repository.js";
import type { CommandRepository } from "../infrastructure/database/command-repository.js";
import { redactError } from "../domain/redaction.js";

export interface AgentGatewayOptions {
  heartbeatIntervalMs: number;
  onChatMessage?: (message: ChatMessageReceived) => Promise<void> | void;
  serverVersion: string;
  now?: () => Date;
}

interface AgentSession {
  agentId?: string;
  capabilities?: ReadonlySet<AgentCapability>;
  chatMessageChain?: Promise<void>;
  lastSeenAt?: number;
  socket: WebSocket;
}

export class AgentGateway {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly now: () => Date;
  private readonly heartbeatTimer: NodeJS.Timeout;

  public constructor(
    private readonly repository: AgentRepository,
    private readonly commandRepository: CommandRepository,
    private readonly logger: FastifyBaseLogger,
    private readonly options: AgentGatewayOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.heartbeatTimer = setInterval(
      () => this.disconnectStaleSessions(),
      options.heartbeatIntervalMs,
    );
    this.heartbeatTimer.unref();
  }

  public attach(socket: WebSocket): void {
    const session: AgentSession = { socket };
    let messageChain = Promise.resolve();

    socket.on("message", (data) => {
      messageChain = messageChain
        .then(() => this.handleRawMessage(session, data))
        .catch((error: unknown) => {
          this.logger.error({ error: redactError(error) }, "Agent message processing failed");
          this.reject(session, "INVALID_MESSAGE", "Message processing failed");
        });
    });

    socket.once("close", () => {
      if (session.agentId !== undefined && this.sessions.get(session.agentId) === session) {
        this.sessions.delete(session.agentId);
        this.repository.markOffline(session.agentId, this.timestamp());
      }
    });
  }

  public sendCommand(agentId: string, message: DesktopCommand): boolean {
    const session = this.sessions.get(agentId);
    if (session?.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.commandRepository.create(message, this.timestamp());
    this.send(session.socket, message);
    return true;
  }

  public cancelTask(taskId: string): number {
    const message: TaskCancel = {
      schemaVersion: SCHEMA_VERSION,
      type: "task.cancel",
      messageId: randomUUID(),
      timestamp: this.timestamp(),
      payload: { taskId },
    };

    this.commandRepository.cancelTask(taskId, message.timestamp);
    return this.broadcast(message);
  }

  public emergencyStop(reason: string): number {
    const message: EmergencyStop = {
      schemaVersion: SCHEMA_VERSION,
      type: "system.emergency-stop",
      messageId: randomUUID(),
      timestamp: this.timestamp(),
      payload: { reason },
    };

    this.commandRepository.cancelAll(message.timestamp);
    return this.broadcast(message);
  }

  public close(): void {
    clearInterval(this.heartbeatTimer);
    const observedAt = this.timestamp();
    for (const session of this.sessions.values()) {
      if (session.agentId !== undefined) {
        this.repository.markOffline(session.agentId, observedAt);
      }
      session.socket.close(1001, "Server shutting down");
    }
    this.sessions.clear();
  }

  public disconnectStaleSessions(): number {
    const cutoff = this.now().getTime() - this.options.heartbeatIntervalMs * 3;
    let disconnected = 0;
    for (const [agentId, session] of this.sessions) {
      if (session.lastSeenAt !== undefined && session.lastSeenAt <= cutoff) {
        this.sessions.delete(agentId);
        this.repository.markOffline(agentId, this.timestamp());
        session.socket.close(1001, "Heartbeat timeout");
        disconnected += 1;
      }
    }
    return disconnected;
  }

  private handleRawMessage(session: AgentSession, data: RawData): void {
    const value = this.parseMessage(data);
    if (value === undefined) {
      this.reject(session, "INVALID_MESSAGE", "Message does not match schema version 1.0");
      return;
    }

    if (session.agentId === undefined) {
      if (value.type !== "agent.hello") {
        this.reject(session, "AGENT_NOT_REGISTERED", "First message must be agent.hello");
        return;
      }
      this.register(session, value);
      return;
    }

    if (value.type === "agent.hello") {
      this.reject(session, "INVALID_MESSAGE", "Agent is already registered");
      return;
    }

    if (value.type === "agent.heartbeat" && value.payload.agentId !== session.agentId) {
      this.reject(session, "AGENT_ID_MISMATCH", "Message agentId does not match this session");
      return;
    }

    if (value.type === "agent.heartbeat") {
      session.lastSeenAt = this.now().getTime();
      this.repository.heartbeat(session.agentId, value.payload.status, this.timestamp());
      return;
    }

    if (value.type === "chat.message.received") {
      if (session.capabilities?.has("wechat.read") !== true) {
        this.reject(session, "INVALID_MESSAGE", "Agent did not declare wechat.read capability");
        return;
      }
      session.chatMessageChain = (session.chatMessageChain ?? Promise.resolve())
        .then(async () => this.options.onChatMessage?.(value))
        .then(() => undefined)
        .catch((error: unknown) => {
          this.logger.error(
            { agentId: session.agentId, error: redactError(error) },
            "Chat message workflow failed unexpectedly",
          );
        });
      return;
    }

    const recorded = this.commandRepository.complete(value, this.timestamp());
    this.logger.info(
      {
        agentId: session.agentId,
        commandId: value.payload.commandId,
        outcome: value.payload.outcome,
        recorded,
      },
      "Desktop command result received",
    );
  }

  private parseMessage(data: RawData): AgentToServerMessage | undefined {
    try {
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString("utf8")
          : data.toString("utf8");
      const value: unknown = JSON.parse(text);
      return isSchemaValue(AgentToServerMessageSchema, value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private register(session: AgentSession, message: AgentHello): void {
    const existing = this.sessions.get(message.payload.agentId);
    if (existing !== undefined) {
      existing.socket.close(1012, "Replaced by a new connection");
    }

    session.agentId = message.payload.agentId;
    session.capabilities = new Set(message.payload.capabilities);
    session.lastSeenAt = this.now().getTime();
    this.sessions.set(message.payload.agentId, session);
    this.repository.register(message, this.timestamp());

    const welcome: ServerWelcome = {
      schemaVersion: SCHEMA_VERSION,
      type: "server.welcome",
      messageId: randomUUID(),
      timestamp: this.timestamp(),
      payload: {
        heartbeatIntervalMs: this.options.heartbeatIntervalMs,
        serverVersion: this.options.serverVersion,
      },
    };
    this.send(session.socket, welcome);
  }

  private reject(
    session: AgentSession,
    code: ProtocolError["payload"]["code"],
    message: string,
  ): void {
    const error: ProtocolError = {
      schemaVersion: SCHEMA_VERSION,
      type: "server.error",
      messageId: randomUUID(),
      timestamp: this.timestamp(),
      payload: { code, message },
    };
    this.send(session.socket, error);
    session.socket.close(1008, code);
  }

  private broadcast(message: ServerToAgentMessage): number {
    let sent = 0;
    for (const session of this.sessions.values()) {
      if (session.socket.readyState === WebSocket.OPEN) {
        this.send(session.socket, message);
        sent += 1;
      }
    }
    return sent;
  }

  private send(socket: WebSocket, message: ServerToAgentMessage): void {
    socket.send(JSON.stringify(message));
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

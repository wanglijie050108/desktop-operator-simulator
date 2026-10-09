import { randomUUID } from "node:crypto";

import { type ChatMessageReceived, SCHEMA_VERSION } from "@hos/contracts";
import type { FastifyBaseLogger } from "fastify";

import type { ChatReplyAdapter } from "../adapters/chat-reply-adapter.js";
import { AdapterError } from "../adapters/adapter-error.js";
import type {
  AiQuestionCommandPolicy,
  CommandRejectionCode,
} from "../domain/ai-question-command.js";
import { buildCommandNotice } from "../domain/command-notice.js";
import { parseProductSearchCommand } from "../domain/product-search-command.js";
import type { InboundMessageRepository } from "../infrastructure/database/inbound-message-repository.js";
import type { TaskRecord, TaskRepository } from "../infrastructure/database/task-repository.js";
import type { AiQuestionWorkflow, MessageHandlingResult } from "./ai-question-workflow.js";
import type { ProductSearchWorkflow } from "./product-search-workflow.js";

const NOTICE_TIMEOUT_MS = 10_000;

export type RecoverTaskResult =
  { outcome: "TASK_CREATED"; taskId: string } | { outcome: "REJECTED"; code: string };

export interface AssistantWorkflowOptions {
  aiQuestionWorkflow: AiQuestionWorkflow;
  aiPolicy: AiQuestionCommandPolicy;
  chatReplyAdapter: ChatReplyAdapter;
  commandPrefix: string;
  inboundMessages: InboundMessageRepository;
  logger: FastifyBaseLogger;
  now?: () => Date;
  productSearchWorkflow: ProductSearchWorkflow;
  tasks: TaskRepository;
}

export class AssistantWorkflow {
  private readonly now: () => Date;

  public constructor(private readonly options: AssistantWorkflowOptions) {
    this.now = options.now ?? (() => new Date());
  }

  public async handleMessage(message: ChatMessageReceived): Promise<MessageHandlingResult> {
    if (!this.options.inboundMessages.insert(message)) {
      return { outcome: "DUPLICATE" };
    }

    const aiDecision = this.options.aiPolicy.evaluate(
      message.payload.senderId,
      message.payload.content,
    );
    if (aiDecision.accepted) {
      return this.options.aiQuestionWorkflow.handleAcceptedMessage(message, aiDecision.question);
    }
    if (aiDecision.code !== "COMMAND_UNSUPPORTED") {
      return this.ignore(message, aiDecision.code);
    }

    const productDecision = parseProductSearchCommand(
      message.payload.content,
      this.options.commandPrefix,
    );
    if (productDecision.accepted) {
      return this.options.productSearchWorkflow.handleAcceptedMessage(
        message,
        productDecision.request,
      );
    }
    if (productDecision.code === "INVALID_ARGUMENTS") {
      return this.options.productSearchWorkflow.handleIncompleteMessage(
        message,
        productDecision.missingFields ?? [],
      );
    }
    return this.ignore(message, productDecision.code);
  }

  /**
   * Rejects a message that carried the command prefix but produced no work, answering the sender
   * when the reason is one the user can act on. The notice is best effort: a missing or unreachable
   * chat channel must never fail message handling, so delivery errors are logged, not thrown.
   */
  private async ignore(
    message: ChatMessageReceived,
    reason: CommandRejectionCode,
  ): Promise<MessageHandlingResult> {
    const notice = buildCommandNotice(reason, this.options.commandPrefix);
    if (notice !== null) {
      await this.sendNotice(message.payload.conversationId, notice, reason);
    }
    return { outcome: "IGNORED", reason };
  }

  private async sendNotice(
    conversationId: string,
    text: string,
    reason: CommandRejectionCode,
  ): Promise<void> {
    try {
      await this.options.chatReplyAdapter.send({
        conversationId,
        signal: AbortSignal.timeout(NOTICE_TIMEOUT_MS),
        text,
      });
    } catch (error) {
      this.options.logger.warn(
        {
          reason,
          errorCode: error instanceof AdapterError ? error.code : "UNKNOWN",
        },
        "Command notice was not delivered",
      );
    }
  }

  public cancel(taskId: string): "CANCELLED" | "NOT_FOUND" | "TERMINAL" {
    const task = this.options.tasks.get(taskId);
    if (task?.type === "AI_QUESTION") {
      return this.options.aiQuestionWorkflow.cancel(taskId);
    }
    if (task?.type === "PRODUCT_SEARCH") {
      this.options.productSearchWorkflow.cancel(taskId);
    }
    return this.options.tasks.cancel(taskId, this.now().toISOString());
  }

  public listTasks(state?: TaskRecord["state"]): TaskRecord[] {
    return this.options.tasks.list(state);
  }

  public getTask(taskId: string): TaskRecord | undefined {
    return this.options.tasks.get(taskId);
  }

  /** Aborts an active task past its deadline. */
  public timeout(taskId: string): boolean {
    const task = this.options.tasks.get(taskId);
    if (task?.type === "AI_QUESTION") {
      return this.options.aiQuestionWorkflow.timeout(taskId);
    }
    if (task?.type === "PRODUCT_SEARCH") {
      return this.options.productSearchWorkflow.timeout(taskId);
    }
    return false;
  }

  /**
   * Explicitly re-runs an interrupted or failed task as a fresh task. Recovery is never
   * automatic: an administrator must request it.
   */
  public async recoverTask(taskId: string): Promise<RecoverTaskResult> {
    const task = this.options.tasks.get(taskId);
    if (task === undefined) {
      return { outcome: "REJECTED", code: "TASK_NOT_FOUND" };
    }
    if (task.state !== "INTERRUPTED" && task.state !== "FAILED") {
      return { outcome: "REJECTED", code: "TASK_NOT_RECOVERABLE" };
    }

    const replay = this.synthesizeReplay(task);
    if (task.type === "AI_QUESTION") {
      const question = this.aiQuestionOf(task.request);
      if (question === null) {
        return { outcome: "REJECTED", code: "INVALID_TASK_REQUEST" };
      }
      return this.toCreated(
        this.options.aiQuestionWorkflow.handleAcceptedMessage(replay, question),
      );
    }

    const productRequest = this.productRequestOf(task.request);
    if (productRequest === null) {
      return { outcome: "REJECTED", code: "INVALID_TASK_REQUEST" };
    }
    return this.toCreated(
      this.options.productSearchWorkflow.handleAcceptedMessage(replay, productRequest),
    );
  }

  private async toCreated(created: Promise<MessageHandlingResult>): Promise<RecoverTaskResult> {
    const result = await created;
    return result.outcome === "TASK_CREATED"
      ? { outcome: "TASK_CREATED", taskId: result.taskId }
      : { outcome: "REJECTED", code: "RECOVERY_REJECTED" };
  }

  private synthesizeReplay(task: TaskRecord): ChatMessageReceived {
    const timestamp = this.now().toISOString();
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "chat.message.received",
      messageId: randomUUID(),
      timestamp,
      payload: {
        source: "WECHAT",
        externalMessageId: `recovery-${task.id}-${randomUUID()}`,
        conversationId: this.conversationIdOf(task.request) ?? task.id,
        senderId: "system-recovery",
        content: "",
        receivedAt: timestamp,
      },
    };
  }

  private conversationIdOf(request: unknown): string | null {
    return this.stringField(request, "conversationId");
  }

  private aiQuestionOf(request: unknown): string | null {
    return this.stringField(request, "question");
  }

  private productRequestOf(request: unknown): {
    candidateCount: number;
    maxPrice: number;
    preferences: string[];
    query: string;
  } | null {
    if (typeof request !== "object" || request === null) {
      return null;
    }
    const query = "query" in request && typeof request.query === "string" ? request.query : null;
    const { maxPrice, candidateCount } = request as {
      candidateCount?: unknown;
      maxPrice?: unknown;
    };
    if (
      query === null ||
      typeof maxPrice !== "number" ||
      maxPrice <= 0 ||
      typeof candidateCount !== "number" ||
      !Number.isInteger(candidateCount) ||
      candidateCount < 1
    ) {
      return null;
    }
    const preferences =
      "preferences" in request && Array.isArray(request.preferences)
        ? request.preferences.filter((value): value is string => typeof value === "string")
        : [];
    return { candidateCount, maxPrice, preferences, query };
  }

  private stringField(request: unknown, field: string): string | null {
    if (typeof request !== "object" || request === null || !(field in request)) {
      return null;
    }
    const value = (request as Record<string, unknown>)[field];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  }
}

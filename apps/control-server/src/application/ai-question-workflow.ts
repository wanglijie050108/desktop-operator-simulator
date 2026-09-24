import { randomUUID } from "node:crypto";

import type { ChatMessageReceived } from "@hos/contracts";

import {
  AdapterError,
  type AiQuestionAdapter,
  type AiQuestionResult,
} from "../adapters/ai-question-adapter.js";
import type { ChatReplyAdapter } from "../adapters/chat-reply-adapter.js";
import type { AiQuestionCommandPolicy } from "../domain/ai-question-command.js";
import type { InboundMessageRepository } from "../infrastructure/database/inbound-message-repository.js";
import type { TaskRecord, TaskRepository } from "../infrastructure/database/task-repository.js";

const POLICY_VERSION = "ai-question-v1";
const STEP_NAMES = ["ValidatePolicy", "AskAi", "SendChatReply"] as const;

export type MessageHandlingResult =
  | { outcome: "DUPLICATE" }
  | { outcome: "IGNORED"; reason: string }
  | { outcome: "TASK_CREATED"; taskId: string };

export interface AiQuestionWorkflowOptions {
  aiAdapter: AiQuestionAdapter;
  chatReplyAdapter: ChatReplyAdapter;
  inboundMessages: InboundMessageRepository;
  now?: () => Date;
  policy: AiQuestionCommandPolicy;
  tasks: TaskRepository;
}

function errorCode(error: unknown): string {
  if (error instanceof AdapterError) {
    return error.code;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "TASK_CANCELLED";
  }
  return "WORKFLOW_FAILED";
}

export class AiQuestionWorkflow {
  private readonly activeTasks = new Map<string, AbortController>();
  private readonly now: () => Date;

  public constructor(private readonly options: AiQuestionWorkflowOptions) {
    this.now = options.now ?? (() => new Date());
  }

  public async handleMessage(message: ChatMessageReceived): Promise<MessageHandlingResult> {
    if (!this.options.inboundMessages.insert(message)) {
      return { outcome: "DUPLICATE" };
    }

    const decision = this.options.policy.evaluate(
      message.payload.senderId,
      message.payload.content,
    );
    if (!decision.accepted) {
      return { outcome: "IGNORED", reason: decision.code };
    }

    return this.handleAcceptedMessage(message, decision.question);
  }

  public async handleAcceptedMessage(
    message: ChatMessageReceived,
    question: string,
  ): Promise<MessageHandlingResult> {
    const taskId = randomUUID();
    const createdAt = this.timestamp();
    const shortCode = taskId.replaceAll("-", "").slice(0, 8).toUpperCase();
    this.options.tasks.create({
      id: taskId,
      shortCode,
      type: "AI_QUESTION",
      request: {
        conversationId: message.payload.conversationId,
        question,
        source: message.payload.source,
      },
      policyVersion: POLICY_VERSION,
      createdAt,
      steps: STEP_NAMES.map((name, index) => ({
        id: randomUUID(),
        name,
        sequence: index + 1,
      })),
    });

    const controller = new AbortController();
    this.activeTasks.set(taskId, controller);
    try {
      await this.execute(taskId, shortCode, message.payload.conversationId, question, controller);
    } finally {
      this.activeTasks.delete(taskId);
    }
    return { outcome: "TASK_CREATED", taskId };
  }

  public cancel(taskId: string): "CANCELLED" | "NOT_FOUND" | "TERMINAL" {
    this.activeTasks.get(taskId)?.abort();
    return this.options.tasks.cancel(taskId, this.timestamp());
  }

  public listTasks(state?: TaskRecord["state"]): TaskRecord[] {
    return this.options.tasks.list(state);
  }

  public getTask(taskId: string): TaskRecord | undefined {
    return this.options.tasks.get(taskId);
  }

  private async execute(
    taskId: string,
    shortCode: string,
    conversationId: string,
    question: string,
    controller: AbortController,
  ): Promise<void> {
    let activeStep = 1;
    try {
      this.options.tasks.setState(taskId, ["RECEIVED"], "PLANNED", this.timestamp());
      this.startStep(taskId, activeStep);
      this.finishStep(taskId, activeStep);

      this.options.tasks.setState(taskId, ["PLANNED"], "RUNNING", this.timestamp());
      activeStep = 2;
      this.startStep(taskId, activeStep);
      const result = await this.options.aiAdapter.ask({
        question,
        signal: controller.signal,
        taskId,
      });
      this.assertActive(controller.signal);
      this.validateAiResult(result);
      this.finishStep(taskId, activeStep);

      activeStep = 3;
      this.startStep(taskId, activeStep);
      await this.options.chatReplyAdapter.send({
        conversationId,
        signal: controller.signal,
        taskId,
        text: this.formatReply(shortCode, result),
      });
      this.assertActive(controller.signal);
      this.finishStep(taskId, activeStep);
      this.options.tasks.setState(taskId, ["RUNNING"], "SUCCEEDED", this.timestamp(), result);
    } catch (error) {
      const code = errorCode(error);
      const task = this.options.tasks.get(taskId);
      if (task?.state === "CANCELLED") {
        return;
      }
      if (code === "LOGIN_REQUIRED" || code === "CAPTCHA_REQUIRED") {
        this.options.tasks.setState(taskId, ["RUNNING"], "WAITING_FOR_HUMAN", this.timestamp(), {
          errorCode: code,
        });
        return;
      }

      this.options.tasks.finishStep(taskId, activeStep, "FAILED", this.timestamp(), code);
      this.options.tasks.skipPending(taskId, this.timestamp(), code);
      this.options.tasks.setState(
        taskId,
        ["RECEIVED", "PLANNED", "RUNNING"],
        "FAILED",
        this.timestamp(),
        { errorCode: code },
      );
    }
  }

  private startStep(taskId: string, sequence: number): void {
    if (!this.options.tasks.startStep(taskId, sequence, this.timestamp())) {
      throw new Error("Task step could not be started");
    }
  }

  private finishStep(taskId: string, sequence: number): void {
    if (!this.options.tasks.finishStep(taskId, sequence, "SUCCEEDED", this.timestamp())) {
      throw new Error("Task step could not be completed");
    }
  }

  private assertActive(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new DOMException("Task was cancelled", "AbortError");
    }
  }

  private validateAiResult(result: AiQuestionResult): void {
    if (
      result.answer.trim().length === 0 ||
      result.answer.length > 3_500 ||
      result.source.trim().length === 0 ||
      result.source.length > 100 ||
      !Number.isFinite(result.durationMs) ||
      !Number.isInteger(result.durationMs) ||
      result.durationMs < 0
    ) {
      throw new AdapterError("SITE_LAYOUT_CHANGED", "AI adapter returned an invalid result");
    }
  }

  private formatReply(shortCode: string, result: AiQuestionResult): string {
    return `任务 ${shortCode} 已完成\n${result.answer}\n来源：${result.source}；耗时：${String(result.durationMs)}ms`;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

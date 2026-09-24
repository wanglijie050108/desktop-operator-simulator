import type { ChatMessageReceived } from "@hos/contracts";

import type { AiQuestionCommandPolicy } from "../domain/ai-question-command.js";
import { parseProductSearchCommand } from "../domain/product-search-command.js";
import type { InboundMessageRepository } from "../infrastructure/database/inbound-message-repository.js";
import type { TaskRecord, TaskRepository } from "../infrastructure/database/task-repository.js";
import type { AiQuestionWorkflow, MessageHandlingResult } from "./ai-question-workflow.js";
import type { ProductSearchWorkflow } from "./product-search-workflow.js";

export interface AssistantWorkflowOptions {
  aiQuestionWorkflow: AiQuestionWorkflow;
  aiPolicy: AiQuestionCommandPolicy;
  commandPrefix: string;
  inboundMessages: InboundMessageRepository;
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
      return { outcome: "IGNORED", reason: aiDecision.code };
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
    return { outcome: "IGNORED", reason: productDecision.code };
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
}

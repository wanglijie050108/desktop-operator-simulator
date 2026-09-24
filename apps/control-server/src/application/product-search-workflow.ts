import { randomUUID } from "node:crypto";

import type { ChatMessageReceived } from "@hos/contracts";

import { AdapterError } from "../adapters/adapter-error.js";
import type {
  ProductCandidate,
  ProductExtractionResult,
  ProductSearchAdapter,
  ProductSearchAdapterRequest,
} from "../adapters/product-search-adapter.js";
import type { ChatReplyAdapter } from "../adapters/chat-reply-adapter.js";
import {
  rankProducts,
  validateProductCandidates,
  type RankedProduct,
} from "../domain/product-ranking.js";
import type { ProductSearchRequest } from "../domain/product-search-command.js";
import type { MessageHandlingResult } from "./ai-question-workflow.js";
import type { TaskRepository } from "../infrastructure/database/task-repository.js";

const POLICY_VERSION = "product-search-v1";
const STEP_NAMES = [
  "ParseShoppingRequest",
  "ValidateShoppingPolicy",
  "OpenShoppingSite",
  "SearchProducts",
  "ExtractCandidates",
  "RankCandidates",
  "SummarizeResults",
  "SendChatReply",
] as const;

export interface ProductSearchResult {
  adapterVersion: string;
  collectedAt: string;
  maxPrice: number;
  products: RankedProduct[];
  query: string;
  source: string;
}

interface ValidatedProductExtraction {
  adapterVersion: string;
  candidates: ProductCandidate[];
  source: string;
}

export interface ProductSearchWorkflowOptions {
  allowedDomains: ReadonlySet<string>;
  chatReplyAdapter: ChatReplyAdapter;
  now?: () => Date;
  productAdapter: ProductSearchAdapter;
  tasks: TaskRepository;
}

function workflowErrorCode(error: unknown): string {
  if (error instanceof AdapterError) {
    return error.code;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "TASK_CANCELLED";
  }
  return "WORKFLOW_FAILED";
}

export class ProductSearchWorkflow {
  private readonly activeTasks = new Map<string, AbortController>();
  private readonly now: () => Date;

  public constructor(private readonly options: ProductSearchWorkflowOptions) {
    this.now = options.now ?? (() => new Date());
  }

  public async handleAcceptedMessage(
    message: ChatMessageReceived,
    request: ProductSearchRequest,
  ): Promise<MessageHandlingResult> {
    const taskId = randomUUID();
    const shortCode = taskId.replaceAll("-", "").slice(0, 8).toUpperCase();
    const createdAt = this.timestamp();
    this.createTask(taskId, shortCode, createdAt, {
      conversationId: message.payload.conversationId,
      ...request,
      source: message.payload.source,
    });

    const controller = new AbortController();
    this.activeTasks.set(taskId, controller);
    try {
      await this.execute(taskId, shortCode, message.payload.conversationId, request, controller);
    } finally {
      this.activeTasks.delete(taskId);
    }
    return { outcome: "TASK_CREATED", taskId };
  }

  public async handleIncompleteMessage(
    message: ChatMessageReceived,
    missingFields: readonly ("candidateCount" | "maxPrice" | "query")[],
  ): Promise<MessageHandlingResult> {
    const taskId = randomUUID();
    const shortCode = taskId.replaceAll("-", "").slice(0, 8).toUpperCase();
    const createdAt = this.timestamp();
    this.createTask(taskId, shortCode, createdAt, {
      conversationId: message.payload.conversationId,
      missingFields,
      source: message.payload.source,
    });

    this.options.tasks.startStep(taskId, 1, this.timestamp());
    this.options.tasks.finishStep(taskId, 1, "FAILED", this.timestamp(), "INVALID_ARGUMENTS");
    this.options.tasks.startStep(taskId, 8, this.timestamp());
    try {
      await this.options.chatReplyAdapter.send({
        conversationId: message.payload.conversationId,
        signal: AbortSignal.timeout(10_000),
        taskId,
        text: this.formatMissingFieldsReply(shortCode, missingFields),
      });
      this.options.tasks.finishStep(taskId, 8, "SUCCEEDED", this.timestamp());
      this.options.tasks.skipPending(taskId, this.timestamp(), "WAITING_FOR_INPUT");
      this.options.tasks.setState(taskId, ["RECEIVED"], "WAITING_FOR_INPUT", this.timestamp(), {
        errorCode: "INVALID_ARGUMENTS",
        missingFields,
      });
    } catch (error) {
      const code = workflowErrorCode(error);
      this.options.tasks.finishStep(taskId, 8, "FAILED", this.timestamp(), code);
      this.options.tasks.skipPending(taskId, this.timestamp(), code);
      this.options.tasks.setState(taskId, ["RECEIVED"], "FAILED", this.timestamp(), {
        errorCode: code,
      });
    }
    return { outcome: "TASK_CREATED", taskId };
  }

  public cancel(taskId: string): void {
    this.activeTasks.get(taskId)?.abort();
  }

  private async execute(
    taskId: string,
    shortCode: string,
    conversationId: string,
    request: ProductSearchRequest,
    controller: AbortController,
  ): Promise<void> {
    let activeStep = 1;
    try {
      this.startAndFinishStep(taskId, activeStep);
      activeStep = 2;
      this.startAndFinishStep(taskId, activeStep);
      this.options.tasks.setState(taskId, ["RECEIVED"], "PLANNED", this.timestamp());
      this.options.tasks.setState(taskId, ["PLANNED"], "RUNNING", this.timestamp());

      const adapterRequest: ProductSearchAdapterRequest = {
        maxPrice: request.maxPrice,
        preferences: request.preferences,
        query: request.query,
        signal: controller.signal,
        taskId,
      };
      activeStep = 3;
      this.startStep(taskId, activeStep);
      await this.options.productAdapter.open(adapterRequest);
      this.assertActive(controller.signal);
      this.finishStep(taskId, activeStep);

      activeStep = 4;
      this.startStep(taskId, activeStep);
      await this.options.productAdapter.search(adapterRequest);
      this.assertActive(controller.signal);
      this.finishStep(taskId, activeStep);

      activeStep = 5;
      this.startStep(taskId, activeStep);
      const extraction = this.validateExtraction(
        await this.options.productAdapter.extract(adapterRequest),
      );
      this.assertActive(controller.signal);
      this.finishStep(taskId, activeStep);

      activeStep = 6;
      this.startStep(taskId, activeStep);
      const products = rankProducts(extraction.candidates, request);
      this.finishStep(taskId, activeStep);

      activeStep = 7;
      this.startStep(taskId, activeStep);
      const result = this.buildResult(request, extraction, products);
      const replyText = this.formatReply(shortCode, result);
      this.finishStep(taskId, activeStep);

      activeStep = 8;
      this.startStep(taskId, activeStep);
      await this.options.chatReplyAdapter.send({
        conversationId,
        signal: controller.signal,
        taskId,
        text: replyText,
      });
      this.assertActive(controller.signal);
      this.finishStep(taskId, activeStep);
      this.options.tasks.setState(taskId, ["RUNNING"], "SUCCEEDED", this.timestamp(), result);
    } catch (error) {
      const code = workflowErrorCode(error);
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

  private validateExtraction(extraction: unknown): ValidatedProductExtraction {
    if (
      typeof extraction !== "object" ||
      extraction === null ||
      !("source" in extraction) ||
      typeof extraction.source !== "string" ||
      extraction.source.trim().length === 0 ||
      extraction.source.length > 100 ||
      !("adapterVersion" in extraction) ||
      typeof extraction.adapterVersion !== "string" ||
      extraction.adapterVersion.trim().length === 0 ||
      extraction.adapterVersion.length > 100 ||
      !("candidates" in extraction) ||
      !Array.isArray(extraction.candidates) ||
      extraction.candidates.length > 100
    ) {
      throw new AdapterError("INVALID_PRODUCT_DATA", "Product extraction metadata is invalid");
    }
    return {
      adapterVersion: extraction.adapterVersion.trim().replace(/\s+/gu, " "),
      candidates: validateProductCandidates(extraction.candidates, this.options.allowedDomains),
      source: extraction.source.trim().replace(/\s+/gu, " "),
    };
  }

  private buildResult(
    request: ProductSearchRequest,
    extraction: Pick<ProductExtractionResult, "adapterVersion" | "source">,
    products: RankedProduct[],
  ): ProductSearchResult {
    const firstProduct = products[0];
    if (firstProduct === undefined) {
      throw new AdapterError("NO_PRODUCTS_IN_BUDGET", "No ranked products are available");
    }
    return {
      adapterVersion: extraction.adapterVersion,
      collectedAt: products.reduce(
        (latest, product) =>
          product.collectedAt.localeCompare(latest) > 0 ? product.collectedAt : latest,
        firstProduct.collectedAt,
      ),
      maxPrice: request.maxPrice,
      products,
      query: request.query,
      source: extraction.source,
    };
  }

  private formatReply(shortCode: string, result: ProductSearchResult): string {
    const lines = result.products.map(
      (product) =>
        `${String(product.rank)}. ${product.title}｜¥${product.price.toFixed(2)}｜${
          product.shopName ?? "店铺未提供"
        }｜评分${product.rating?.toFixed(1) ?? "未提供"}｜${
          product.salesText ?? "销量未提供"
        }\n${product.url}`,
    );
    return [
      `任务 ${shortCode} 已完成：${result.query}（预算 ¥${result.maxPrice.toFixed(2)}）`,
      ...lines,
      `排序范围：本次有效候选；来源：${result.source}；采集时间：${result.collectedAt}`,
    ].join("\n");
  }

  private formatMissingFieldsReply(
    shortCode: string,
    missingFields: readonly ("candidateCount" | "maxPrice" | "query")[],
  ): string {
    const labels = {
      candidateCount: "候选数量（1-3款）",
      maxPrice: "最高预算",
      query: "商品关键词",
    } as const;
    return `任务 ${shortCode} 需要补充：${missingFields.map((field) => labels[field]).join("、")}`;
  }

  private createTask(taskId: string, shortCode: string, createdAt: string, request: unknown): void {
    this.options.tasks.create({
      id: taskId,
      shortCode,
      type: "PRODUCT_SEARCH",
      request,
      policyVersion: POLICY_VERSION,
      createdAt,
      steps: STEP_NAMES.map((name, index) => ({
        id: randomUUID(),
        name,
        sequence: index + 1,
      })),
    });
  }

  private startAndFinishStep(taskId: string, sequence: number): void {
    this.startStep(taskId, sequence);
    this.finishStep(taskId, sequence);
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

  private timestamp(): string {
    return this.now().toISOString();
  }
}

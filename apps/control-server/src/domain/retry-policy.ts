import { AdapterError } from "../adapters/adapter-error.js";

/** Operation identifiers allowed to auto-retry. Only read-only operations qualify. */
export const RETRYABLE_OPERATIONS = new Set([
  "ai.ask",
  "product.open",
  "product.search",
  "product.extract",
]);

/** Error codes that describe a transient condition worth another attempt. */
export const TRANSIENT_ERROR_CODES = new Set([
  "ADAPTER_TIMEOUT",
  "NETWORK_ERROR",
  "TEMPORARY_UNAVAILABLE",
  "SERVICE_UNAVAILABLE",
]);

export interface RetryPolicyOptions {
  /** Maximum number of total attempts including the first one. */
  maxAttempts?: number;
  /** Delay before the second attempt. Each subsequent attempt doubles the delay. */
  baseDelayMs?: number;
  /** Injected delay function so tests stay deterministic and fast. */
  sleep?: (delayMs: number) => Promise<void>;
  /** Called after every failed attempt that will be retried. */
  onRetry?: (operation: string, attempt: number, delayMs: number, error: unknown) => void;
}

export type RetryOperation<T> = (attempt: number) => Promise<T>;

function errorCode(error: unknown): string | null {
  if (error instanceof AdapterError) {
    return error.code;
  }
  return null;
}

export class RetryPolicy {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly onRetry?: RetryPolicyOptions["onRetry"];

  public constructor(options: RetryPolicyOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 2;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.sleep = options.sleep ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
    this.onRetry = options.onRetry;

    if (this.maxAttempts < 1 || this.maxAttempts > 5) {
      throw new Error("maxAttempts must be between 1 and 5");
    }
    if (this.baseDelayMs < 0) {
      throw new Error("baseDelayMs must not be negative");
    }
  }

  public async execute<T>(operationId: string, operation: RetryOperation<T>): Promise<T> {
    if (!RETRYABLE_OPERATIONS.has(operationId)) {
      throw new Error(`Operation '${operationId}' is not allowed to auto-retry`);
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        if (attempt === this.maxAttempts || !this.isRetryable(error)) {
          throw error;
        }

        const delayMs = this.baseDelayMs * 2 ** (attempt - 1);
        this.onRetry?.(operationId, attempt + 1, delayMs, error);
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  private isRetryable(error: unknown): boolean {
    const code = errorCode(error);
    return code !== null && TRANSIENT_ERROR_CODES.has(code);
  }
}

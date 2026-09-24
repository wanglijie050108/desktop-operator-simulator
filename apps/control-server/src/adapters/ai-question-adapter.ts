export interface AiQuestionRequest {
  question: string;
  signal: AbortSignal;
  taskId: string;
}

export interface AiQuestionResult {
  answer: string;
  durationMs: number;
  source: string;
}

export interface AiQuestionAdapter {
  ask(request: AiQuestionRequest): Promise<AiQuestionResult>;
}

export class AdapterError extends Error {
  public constructor(
    public readonly code:
      | "ADAPTER_NOT_CONFIGURED"
      | "AI_PAGE_UNAVAILABLE"
      | "LOGIN_REQUIRED"
      | "CAPTCHA_REQUIRED"
      | "SITE_LAYOUT_CHANGED",
    message: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export class UnavailableAiQuestionAdapter implements AiQuestionAdapter {
  public ask(): Promise<AiQuestionResult> {
    return Promise.reject(
      new AdapterError("ADAPTER_NOT_CONFIGURED", "A real AI page adapter has not been configured"),
    );
  }
}

import { AdapterError } from "./adapter-error.js";

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

export class UnavailableAiQuestionAdapter implements AiQuestionAdapter {
  public ask(): Promise<AiQuestionResult> {
    return Promise.reject(
      new AdapterError("ADAPTER_NOT_CONFIGURED", "A real AI page adapter has not been configured"),
    );
  }
}

export { AdapterError };

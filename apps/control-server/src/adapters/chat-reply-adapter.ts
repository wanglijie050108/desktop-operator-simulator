import { AdapterError } from "./adapter-error.js";

export interface ChatReplyRequest {
  conversationId: string;
  signal: AbortSignal;
  taskId: string;
  text: string;
}

export interface ChatReplyAdapter {
  send(request: ChatReplyRequest): Promise<void>;
}

export class UnavailableChatReplyAdapter implements ChatReplyAdapter {
  public send(): Promise<void> {
    return Promise.reject(
      new AdapterError(
        "ADAPTER_NOT_CONFIGURED",
        "A real desktop chat reply adapter has not been configured",
      ),
    );
  }
}

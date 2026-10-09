import { AdapterError } from "./adapter-error.js";

export interface ChatReplyRequest {
  conversationId: string;
  signal: AbortSignal;
  /**
   * Task this reply belongs to. Absent for notices that answer an unusable command and therefore
   * have no persisted task; a transport that needs a correlation id derives one itself.
   */
  taskId?: string;
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

import type { ChatMessageReceived } from "@hos/contracts";
import { count } from "drizzle-orm";

import type { DatabaseContext } from "./database.js";
import { inboundMessages } from "./schema.js";

export class InboundMessageRepository {
  public constructor(private readonly context: DatabaseContext) {}

  public insert(message: ChatMessageReceived): boolean {
    const result = this.context.db
      .insert(inboundMessages)
      .values({
        id: message.messageId,
        source: message.payload.source,
        externalMessageId: message.payload.externalMessageId,
        conversationId: message.payload.conversationId,
        senderId: message.payload.senderId,
        content: message.payload.content,
        receivedAt: message.payload.receivedAt,
      })
      .onConflictDoNothing()
      .run();

    return result.changes === 1;
  }

  public count(): number {
    return this.context.db.select({ value: count() }).from(inboundMessages).get()?.value ?? 0;
  }
}

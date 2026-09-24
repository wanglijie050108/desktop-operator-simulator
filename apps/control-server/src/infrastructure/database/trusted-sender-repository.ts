import { eq } from "drizzle-orm";

import type { DatabaseContext } from "./database.js";
import { trustedSenders } from "./schema.js";

export class TrustedSenderRepository {
  public constructor(private readonly context: DatabaseContext) {}

  public add(senderId: string, observedAt: string): void {
    this.context.db
      .insert(trustedSenders)
      .values({
        senderId,
        enabled: true,
        createdAt: observedAt,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: trustedSenders.senderId,
        set: { enabled: true, updatedAt: observedAt },
      })
      .run();
  }

  public isTrusted(senderId: string): boolean {
    return (
      this.context.db
        .select({ enabled: trustedSenders.enabled })
        .from(trustedSenders)
        .where(eq(trustedSenders.senderId, senderId))
        .get()?.enabled === true
    );
  }
}

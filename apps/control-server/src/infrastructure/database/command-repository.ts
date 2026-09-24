import type { DesktopCommand, DesktopCommandResult } from "@hos/contracts";
import { and, eq } from "drizzle-orm";

import type { DatabaseContext } from "./database.js";
import { desktopCommands } from "./schema.js";

export class CommandRepository {
  public constructor(private readonly context: DatabaseContext) {}

  public create(message: DesktopCommand, createdAt: string): void {
    this.context.db
      .insert(desktopCommands)
      .values({
        commandId: message.payload.commandId,
        taskId: message.payload.taskId,
        action: message.payload.action,
        state: "PENDING",
        expiresAt: message.payload.expiresAt,
        createdAt,
      })
      .onConflictDoNothing()
      .run();
  }

  public complete(message: DesktopCommandResult, completedAt: string): boolean {
    const result = this.context.db
      .update(desktopCommands)
      .set({
        state: message.payload.outcome,
        completedAt,
        errorCode: message.payload.errorCode ?? null,
      })
      .where(
        and(
          eq(desktopCommands.commandId, message.payload.commandId),
          eq(desktopCommands.taskId, message.payload.taskId),
          eq(desktopCommands.state, "PENDING"),
        ),
      )
      .run();

    return result.changes === 1;
  }

  public cancelTask(taskId: string, completedAt: string): number {
    return this.context.db
      .update(desktopCommands)
      .set({
        state: "CANCELLED",
        completedAt,
        errorCode: "TASK_CANCELLED",
      })
      .where(and(eq(desktopCommands.taskId, taskId), eq(desktopCommands.state, "PENDING")))
      .run().changes;
  }

  public cancelAll(completedAt: string): number {
    return this.context.db
      .update(desktopCommands)
      .set({
        state: "CANCELLED",
        completedAt,
        errorCode: "TASK_CANCELLED",
      })
      .where(eq(desktopCommands.state, "PENDING"))
      .run().changes;
  }
}

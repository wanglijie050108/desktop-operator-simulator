import type { AgentCapability, AgentHello, AgentStatus } from "@hos/contracts";
import { desc, eq } from "drizzle-orm";

import type { DatabaseContext } from "./database.js";
import { agents } from "./schema.js";

export interface AgentRecord {
  id: string;
  name: string;
  status: AgentStatus;
  capabilities: AgentCapability[];
  lastSeenAt: string;
  version: string;
}

export class AgentRepository {
  public constructor(private readonly context: DatabaseContext) {}

  public register(message: AgentHello, observedAt: string): void {
    const { agentId, capabilities, name, version } = message.payload;

    this.context.db
      .insert(agents)
      .values({
        id: agentId,
        name,
        status: "ONLINE",
        capabilitiesJson: JSON.stringify(capabilities),
        lastSeenAt: observedAt,
        version,
        connectedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: agents.id,
        set: {
          name,
          status: "ONLINE",
          capabilitiesJson: JSON.stringify(capabilities),
          lastSeenAt: observedAt,
          version,
          connectedAt: observedAt,
        },
      })
      .run();
  }

  public heartbeat(agentId: string, status: AgentStatus, observedAt: string): boolean {
    const result = this.context.db
      .update(agents)
      .set({
        status,
        lastSeenAt: observedAt,
      })
      .where(eq(agents.id, agentId))
      .run();

    return result.changes === 1;
  }

  public markOffline(agentId: string, observedAt: string): void {
    this.context.db
      .update(agents)
      .set({
        status: "OFFLINE",
        lastSeenAt: observedAt,
      })
      .where(eq(agents.id, agentId))
      .run();
  }

  public list(): AgentRecord[] {
    return this.context.db
      .select()
      .from(agents)
      .orderBy(desc(agents.lastSeenAt))
      .all()
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        capabilities: JSON.parse(agent.capabilitiesJson) as AgentCapability[],
        lastSeenAt: agent.lastSeenAt,
        version: agent.version,
      }));
  }
}

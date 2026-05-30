import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agent } from "@/db/schema";
import type { AgentRenderTarget, AgentDataSource, AgentResult } from "@/db/schema";

export type AgentRow = {
  id: string;
  title: string;
  instruction: string;
  renderTarget: AgentRenderTarget;
  dataSource: AgentDataSource;
  model: string;
  schedule: string;
  budgetCents: number;
  position: number;
  enabled: boolean;
  lastResult: AgentResult | null;
  lastRunAt: Date | null;
  lastModel: string | null;
  lastCostMicros: number;
  createdAt: Date;
};

/** A user's non-archived agents, in board order. */
export async function listAgents(userId: string): Promise<AgentRow[]> {
  return db
    .select({
      id: agent.id,
      title: agent.title,
      instruction: agent.instruction,
      renderTarget: agent.renderTarget,
      dataSource: agent.dataSource,
      model: agent.model,
      schedule: agent.schedule,
      budgetCents: agent.budgetCents,
      position: agent.position,
      enabled: agent.enabled,
      lastResult: agent.lastResult,
      lastRunAt: agent.lastRunAt,
      lastModel: agent.lastModel,
      lastCostMicros: agent.lastCostMicros,
      createdAt: agent.createdAt,
    })
    .from(agent)
    .where(and(eq(agent.userId, userId), eq(agent.archived, false)))
    .orderBy(asc(agent.position), asc(agent.createdAt));
}

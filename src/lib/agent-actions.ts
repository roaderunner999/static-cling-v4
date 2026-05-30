"use server";

import { and, desc, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { db } from "@/db";
import { agent, note } from "@/db/schema";
import type { AgentResult, AgentRenderTarget, AgentDataSource } from "@/db/schema";
import { getAnthropic } from "@/lib/anthropic";
import { recordUsage } from "@/lib/usage";
import { costMicros, resolveModel } from "@/lib/models";
import { listTasks } from "@/lib/task-queries";
import {
  buildSystemPrompt,
  extractJson,
  renderTargetInfo,
  dataSourceInfo,
  MAX_TOKENS_BY_TARGET,
} from "@/lib/agents";

/**
 * Agents — write side (server actions, so no /api route → no nginx block). Every
 * action re-checks ownership against the session. `runAgent` is the execution
 * engine: it assembles the data source, runs one Claude call that returns the
 * render target's JSON shape, logs the spend, and caches the result on the row.
 */

type AgentInput = {
  title?: string;
  instruction?: string;
  renderTarget?: AgentRenderTarget;
  dataSource?: AgentDataSource;
  model?: string;
  schedule?: string;
  budgetCents?: number;
};

function clean(input: AgentInput) {
  const set: Record<string, unknown> = {};
  if (input.title !== undefined) set.title = input.title.trim().slice(0, 120) || "New agent";
  if (input.instruction !== undefined) set.instruction = input.instruction.slice(0, 2000);
  if (input.renderTarget !== undefined) set.renderTarget = renderTargetInfo(input.renderTarget).id;
  if (input.dataSource !== undefined) set.dataSource = dataSourceInfo(input.dataSource).id;
  if (input.model !== undefined) set.model = resolveModel(input.model).id;
  if (input.schedule !== undefined) set.schedule = input.schedule.slice(0, 40) || "manual";
  if (input.budgetCents !== undefined)
    set.budgetCents = Math.min(500, Math.max(1, Math.round(input.budgetCents)));
  return set;
}

export async function createAgent(input: AgentInput): Promise<{ id: string } | null> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");

  const [{ value: maxPos } = { value: null }] = await db
    .select({ value: max(agent.position) })
    .from(agent)
    .where(eq(agent.userId, session.user.id));

  const [row] = await db
    .insert(agent)
    .values({
      userId: session.user.id,
      position: (maxPos ?? -1) + 1,
      ...clean(input),
    })
    .returning({ id: agent.id });

  revalidatePath("/agents");
  return { id: row.id };
}

export async function updateAgent(id: string, input: AgentInput): Promise<{ ok: true }> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  await db
    .update(agent)
    .set({ ...clean(input), updatedAt: new Date() })
    .where(and(eq(agent.id, id), eq(agent.userId, session.user.id)));
  revalidatePath("/agents");
  return { ok: true };
}

export async function deleteAgent(id: string): Promise<{ ok: true }> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  await db.delete(agent).where(and(eq(agent.id, id), eq(agent.userId, session.user.id)));
  revalidatePath("/agents");
  return { ok: true };
}

/** Persist a new board order. `orderedIds` is the full list in the desired order. */
export async function reorderAgents(orderedIds: string[]): Promise<{ ok: true }> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  await Promise.all(
    orderedIds.map((id, i) =>
      db
        .update(agent)
        .set({ position: i })
        .where(and(eq(agent.id, id), eq(agent.userId, session.user.id))),
    ),
  );
  revalidatePath("/agents");
  return { ok: true };
}

/** Assemble the user's own data as plain-text context for tasks/notes sources. */
async function sourceContext(dataSource: AgentDataSource, userId: string): Promise<string> {
  if (dataSource === "tasks") {
    const tasks = (await listTasks(userId)).slice(0, 100);
    if (!tasks.length) return "The user's task board is empty.";
    const lines = tasks.map((t) => {
      const due = t.dueAt ? ` (due ${new Date(t.dueAt).toISOString().slice(0, 10)})` : "";
      const goal = t.goal ? ` [${t.goal}]` : "";
      return `- [${t.status}/${t.priority}] ${t.title}${goal}${due}${t.detail ? ` — ${t.detail}` : ""}`;
    });
    return `Here is the user's current task board:\n${lines.join("\n")}`;
  }
  if (dataSource === "notes") {
    const notes = await db
      .select({ title: note.title, plainText: note.plainText })
      .from(note)
      .where(and(eq(note.userId, userId), eq(note.archived, false)))
      .orderBy(desc(note.updatedAt))
      .limit(20);
    if (!notes.length) return "The user has no notes yet.";
    const blocks = notes.map(
      (n) => `### ${n.title || "Untitled"}\n${(n.plainText || "").slice(0, 600)}`,
    );
    return `Here are the user's notes (truncated):\n${blocks.join("\n\n")}`;
  }
  return "";
}

export type AgentRunReturn = {
  result: AgentResult;
  costMicros: number;
  model: string | null;
  ranAt: string;
};

export async function runAgent(id: string): Promise<AgentRunReturn> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");

  const [row] = await db
    .select()
    .from(agent)
    .where(and(eq(agent.id, id), eq(agent.userId, session.user.id)))
    .limit(1);
  if (!row) throw new Error("Agent not found.");

  const ranAt = new Date().toISOString();
  const target = renderTargetInfo(row.renderTarget).id;
  const source = dataSourceInfo(row.dataSource);
  const modelInfo = resolveModel(row.model);

  let result: AgentResult;
  let runCost = 0;
  let runModel: string | null = null;
  try {
    const context = await sourceContext(source.id, session.user.id);
    const userText = [
      `Task: ${row.instruction || row.title}`,
      context && `\n${context}`,
    ]
      .filter(Boolean)
      .join("\n");

    const anthropic = getAnthropic();
    const msg = await anthropic.messages.create({
      model: modelInfo.id,
      max_tokens: MAX_TOKENS_BY_TARGET[target],
      system: buildSystemPrompt(target),
      messages: [{ role: "user", content: userText }],
      ...(source.web ? { tools: modelInfo.webTools as never } : {}),
    });

    // Log the spend honestly (web searches add input tokens; we cap output).
    await recordUsage({
      userId: session.user.id,
      model: modelInfo.id,
      inputTokens: msg.usage.input_tokens ?? 0,
      outputTokens: msg.usage.output_tokens ?? 0,
      cacheReadInputTokens: msg.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? 0,
      meta: { feature: "agent", agentId: row.id, dataSource: source.id },
    });

    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("\n");
    const parsed = extractJson(text);

    if (parsed) {
      const caption = typeof parsed.caption === "string" ? parsed.caption : undefined;
      result = { target, data: parsed, caption, ranAt };
    } else {
      // Couldn't get the asked-for shape — fall back to showing the prose.
      result = { target: "text", data: { text: text || "No result." }, ranAt };
    }

    runCost = costMicros(modelInfo.id, {
      inputTokens: msg.usage.input_tokens ?? 0,
      outputTokens: msg.usage.output_tokens ?? 0,
      cacheReadInputTokens: msg.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? 0,
    });
    runModel = modelInfo.id;

    await db
      .update(agent)
      .set({
        lastResult: result,
        lastRunAt: new Date(),
        lastModel: modelInfo.id,
        lastCostMicros: runCost,
        updatedAt: new Date(),
      })
      .where(and(eq(agent.id, id), eq(agent.userId, session.user.id)));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Run failed.";
    result = { target, data: null, error: message, ranAt };
    await db
      .update(agent)
      .set({ lastResult: result, lastRunAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agent.id, id), eq(agent.userId, session.user.id)));
  }

  revalidatePath("/agents");
  return { result, costMicros: runCost, model: runModel, ranAt };
}

/** Pull the agents that lead the board (for the dashboard tile preview later). */
export async function recentAgentRun() {
  const session = await getSession();
  if (!session) return null;
  const [row] = await db
    .select({ id: agent.id, title: agent.title, lastRunAt: agent.lastRunAt })
    .from(agent)
    .where(eq(agent.userId, session.user.id))
    .orderBy(desc(agent.lastRunAt))
    .limit(1);
  return row ?? null;
}

"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { db } from "@/db";
import { task } from "@/db/schema";
import type { ChecklistItem } from "@/lib/task-queries";

/**
 * Tasks write side — server actions (no API routes → no nginx block). Every
 * action re-checks ownership against the session.
 */

export async function createTask(input: {
  title: string;
  goal?: string;
  priority?: string;
}): Promise<{ id: string } | null> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  const title = input.title.trim().slice(0, 300);
  if (!title) return null;

  const [row] = await db
    .insert(task)
    .values({
      userId: session.user.id,
      title,
      goal: (input.goal ?? "").trim().slice(0, 80),
      priority: input.priority ?? "medium",
    })
    .returning({ id: task.id });

  revalidatePath("/tasks");
  return { id: row.id };
}

type TaskPatch = {
  title?: string;
  detail?: string;
  goal?: string;
  status?: string;
  priority?: string;
  dueAt?: Date | null;
  checklist?: ChecklistItem[];
};

export async function updateTask(id: string, patch: TaskPatch): Promise<{ ok: true }> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title.trim().slice(0, 300);
  if (patch.detail !== undefined) set.detail = patch.detail.slice(0, 2000);
  if (patch.goal !== undefined) set.goal = patch.goal.trim().slice(0, 80);
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt;
  if (patch.checklist !== undefined) set.checklist = patch.checklist;

  await db
    .update(task)
    .set(set)
    .where(and(eq(task.id, id), eq(task.userId, session.user.id)));

  revalidatePath("/tasks");
  return { ok: true };
}

export async function deleteTask(id: string): Promise<{ ok: true }> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  await db.delete(task).where(and(eq(task.id, id), eq(task.userId, session.user.id)));
  revalidatePath("/tasks");
  return { ok: true };
}

/**
 * Bulk import from the legacy task-board JSON export ({goals, tasks}). Maps
 * goalId → goal name, priority med→medium / urgent→high, subtasks → checklist.
 * Owner-scoped; capped to keep a single import sane.
 */
type LegacyExport = {
  goals?: { id?: string; name?: string }[];
  tasks?: {
    title?: string;
    notes?: string;
    goalId?: string;
    status?: string;
    priority?: string;
    due?: string;
    subtasks?: { text?: string; done?: boolean }[];
  }[];
};

const PRIORITY_MAP: Record<string, string> = {
  low: "low",
  med: "medium",
  medium: "medium",
  high: "high",
  urgent: "high",
};

export async function importTasks(payload: LegacyExport): Promise<{ imported: number }> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");

  const goalName = new Map(
    (payload.goals ?? []).map((g) => [g.id ?? "", g.name ?? ""]),
  );

  const rows = (payload.tasks ?? [])
    .filter((t) => (t.title ?? "").trim())
    .slice(0, 1000)
    .map((t) => ({
      userId: session.user.id,
      title: (t.title ?? "").trim().slice(0, 300),
      detail: (t.notes ?? "").slice(0, 2000),
      goal: (t.goalId ? (goalName.get(t.goalId) ?? "") : "").slice(0, 80),
      status: t.status === "done" ? "done" : t.status === "doing" ? "doing" : "todo",
      priority: PRIORITY_MAP[(t.priority ?? "").toLowerCase()] ?? "medium",
      dueAt: t.due && !Number.isNaN(Date.parse(t.due)) ? new Date(t.due) : null,
      checklist: (t.subtasks ?? [])
        .map((s) => ({ text: String(s.text ?? ""), done: Boolean(s.done) }))
        .filter((s) => s.text),
    }));

  if (rows.length === 0) return { imported: 0 };
  await db.insert(task).values(rows);
  revalidatePath("/tasks");
  return { imported: rows.length };
}

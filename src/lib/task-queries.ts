import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { task } from "@/db/schema";

export type ChecklistItem = { text: string; done: boolean };

export type TaskRow = {
  id: string;
  title: string;
  detail: string;
  goal: string;
  status: string; // todo | doing | done
  priority: string; // low | medium | high
  dueAt: Date | null;
  checklist: ChecklistItem[];
  createdAt: Date;
};

/** A user's non-archived tasks (newest activity first, but done sinks). */
export async function listTasks(userId: string): Promise<TaskRow[]> {
  return db
    .select({
      id: task.id,
      title: task.title,
      detail: task.detail,
      goal: task.goal,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt,
      checklist: task.checklist,
      createdAt: task.createdAt,
    })
    .from(task)
    .where(and(eq(task.userId, userId), eq(task.archived, false)))
    .orderBy(asc(task.createdAt), desc(task.updatedAt));
}

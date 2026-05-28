import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { note } from "@/db/schema";

/**
 * Read side of Notes. Owner-scoped: callers pass the session user's id, never a
 * value from the client. `doc` is the Tiptap JSON; the list view only needs a
 * title + a short text preview, so listNotes keeps the payload lean.
 */

export type NoteSummary = {
  id: string;
  title: string;
  preview: string;
  updatedAt: Date;
};

export type NoteDoc = {
  id: string;
  title: string;
  doc: Record<string, unknown>;
  updatedAt: Date;
};

export async function listNotes(userId: string): Promise<NoteSummary[]> {
  const rows = await db
    .select({
      id: note.id,
      title: note.title,
      plainText: note.plainText,
      updatedAt: note.updatedAt,
    })
    .from(note)
    .where(and(eq(note.userId, userId), eq(note.archived, false)))
    .orderBy(desc(note.updatedAt));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    preview: r.plainText.replace(/\s+/g, " ").slice(0, 100),
    updatedAt: r.updatedAt,
  }));
}

export async function getNote(
  id: string,
  userId: string,
): Promise<NoteDoc | null> {
  const rows = await db
    .select({
      id: note.id,
      title: note.title,
      doc: note.doc,
      updatedAt: note.updatedAt,
    })
    .from(note)
    .where(and(eq(note.id, id), eq(note.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

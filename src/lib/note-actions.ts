"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { db } from "@/db";
import { note } from "@/db/schema";
import { getNote } from "@/lib/note-queries";
import { getAnthropic } from "@/lib/anthropic";
import { recordUsage } from "@/lib/usage";

/**
 * Write side of Notes — all server actions (no API routes), so they ride Next's
 * action endpoint and dodge the nginx /api → :8080 shadow. Every action
 * re-checks ownership against the session; the client only ever sends an id.
 *
 * Autosave calls `saveNote` on a debounce from the editor.
 */

/**
 * Inline AI actions for Notes — select text (or use the whole note) and have
 * Claude rewrite it. A server action (no API route → no nginx block). Returns
 * plain text so it drops cleanly into the rich editor; the call is logged to the
 * usage ledger. Sonnet 4.6 is the editing workhorse.
 */
export type AiAction =
  | "improve"
  | "shorten"
  | "lengthen"
  | "fix"
  | "summarize"
  | "continue";

const AI_INSTRUCTIONS: Record<AiAction, string> = {
  improve:
    "Improve the writing — clearer, smoother, stronger word choice. Keep the meaning and roughly the same length.",
  shorten: "Make it more concise while keeping the key points.",
  lengthen: "Expand it with more useful detail and explanation.",
  fix: "Fix spelling, grammar, and punctuation only. Do not change the meaning, tone, or style.",
  summarize: "Summarize it into a short, clear summary.",
  continue:
    "Continue writing naturally from where this text leaves off. Return ONLY the new continuation, not the original text.",
};

const AI_SYSTEM =
  "You are an editing assistant inside a notes app. Apply the requested transformation to the user's text. Return ONLY the resulting plain text — no preamble, no quotation marks, no markdown symbols, no commentary.";

export async function aiTransform(action: AiAction, text: string): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");

  const clean = text.trim().slice(0, 20_000);
  if (!clean) return "";
  const instruction = AI_INSTRUCTIONS[action] ?? AI_INSTRUCTIONS.improve;

  const anthropic = getAnthropic();
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: AI_SYSTEM,
    messages: [{ role: "user", content: `${instruction}\n\nText:\n${clean}` }],
  });

  await recordUsage({
    userId: session.user.id,
    model: "claude-sonnet-4-6",
    inputTokens: msg.usage.input_tokens ?? 0,
    outputTokens: msg.usage.output_tokens ?? 0,
    meta: { feature: "notes-ai", action },
  });

  const block = msg.content.find((b) => b.type === "text");
  return block && "text" in block ? block.text.trim() : "";
}

export async function createNote(): Promise<{ id: string }> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");

  const [row] = await db
    .insert(note)
    .values({ userId: session.user.id, title: "Untitled" })
    .returning({ id: note.id });

  revalidatePath("/notes");
  return { id: row.id };
}

export async function saveNote(
  id: string,
  // The Tiptap doc is passed as a STRING, not an object: passing it as an object
  // through the Next Server Action boundary silently dropped ~half the doc in
  // transit (a 652-byte doc arrived as 318), which quietly ate any embedded image
  // while leaving the text intact. A string crosses the boundary verbatim.
  data: { title: string; docJson: string; plainText: string },
): Promise<{ ok: true }> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");

  let doc: Record<string, unknown> = {};
  try {
    doc = JSON.parse(data.docJson ?? "{}") as Record<string, unknown>;
  } catch {
    doc = {};
  }
  const title = data.title.trim().slice(0, 200) || "Untitled";

  await db
    .update(note)
    .set({
      title,
      doc,
      plainText: data.plainText.slice(0, 100_000),
      updatedAt: new Date(),
    })
    .where(and(eq(note.id, id), eq(note.userId, session.user.id)));

  return { ok: true };
}

export async function loadNote(
  id: string,
): Promise<{ title: string; doc: Record<string, unknown> } | null> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  const n = await getNote(id, session.user.id);
  return n ? { title: n.title, doc: n.doc } : null;
}

export async function deleteNote(id: string): Promise<{ ok: true }> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");

  await db
    .delete(note)
    .where(and(eq(note.id, id), eq(note.userId, session.user.id)));

  revalidatePath("/notes");
  return { ok: true };
}

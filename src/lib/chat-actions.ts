"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { db } from "@/db";
import { conversation } from "@/db/schema";
import { getConversation, getMessages, type Attachment } from "@/lib/chat-queries";

export type LoadedMessage = {
  id: string;
  role: string;
  content: string;
  model: string | null;
  attachments: Attachment[];
};

/**
 * Load one conversation's messages for the client (owner-checked). A server
 * action rather than a GET route so it dodges the nginx /api → :8080 shadow and
 * needs no extra nginx block. Returns a lean shape (no Dates) for clean
 * serialization across the action boundary.
 */
export async function loadConversation(id: string): Promise<LoadedMessage[]> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");

  const convo = await getConversation(id, session.user.id);
  if (!convo) return [];

  const messages = await getMessages(id);
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    model: m.model,
    attachments: m.attachments,
  }));
}

/**
 * Write side of chat that isn't streaming. Renaming and deleting a thread are
 * server actions (not API routes) so they ride Next's action endpoint and dodge
 * the nginx /api → :8080 legacy shadow. Sending a message is the one thing that
 * must stream, so that lives in /api/chat (with its own nginx location).
 *
 * Every action re-checks ownership against the session — the client only ever
 * sends an id, never authority.
 */

export async function renameConversation(id: string, title: string) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");

  const clean = title.trim().slice(0, 200) || "New chat";
  await db
    .update(conversation)
    .set({ title: clean, updatedAt: new Date() })
    .where(and(eq(conversation.id, id), eq(conversation.userId, session.user.id)));

  revalidatePath("/chat");
}

export async function deleteConversation(id: string) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");

  // Messages cascade-delete via the FK on message.conversation_id.
  await db
    .delete(conversation)
    .where(and(eq(conversation.id, id), eq(conversation.userId, session.user.id)));

  revalidatePath("/chat");
}

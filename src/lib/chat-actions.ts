"use server";

import { and, desc, eq, ilike } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { db } from "@/db";
import { conversation, message } from "@/db/schema";
import { getConversation, getMessages, type Attachment } from "@/lib/chat-queries";
import { likePattern, snippetAround } from "@/lib/search-util";

/**
 * Content search over the user's own conversations — matches inside message
 * bodies (either side of the chat), not just the title the client already
 * filters. Owner-scoped via the session join; returns the matching
 * conversation ids + a snippet from the most-recent matching message.
 */
export async function searchChatContent(
  query: string,
): Promise<{ id: string; snippet: string }[]> {
  const session = await getSession();
  if (!session) return [];
  const needle = query.trim();
  if (needle.length < 2) return [];

  const rows = await db
    .select({ conversationId: message.conversationId, content: message.content })
    .from(message)
    .innerJoin(conversation, eq(message.conversationId, conversation.id))
    .where(
      and(
        eq(conversation.userId, session.user.id),
        eq(conversation.archived, false),
        ilike(message.content, likePattern(needle)),
      ),
    )
    .orderBy(desc(message.createdAt))
    .limit(200);

  // Collapse to one snippet per conversation — the most-recent match wins.
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (!seen.has(r.conversationId)) {
      seen.set(r.conversationId, snippetAround(r.content, needle));
    }
  }
  return [...seen.entries()].map(([id, snippet]) => ({ id, snippet }));
}

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

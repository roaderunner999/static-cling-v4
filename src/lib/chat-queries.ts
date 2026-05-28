import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversation, message } from "@/db/schema";

/**
 * Read side of chat. Everything is scoped by userId so a signed-in user can
 * only ever see their own threads — the route and the server actions pass the
 * session user's id, never a value from the client.
 */

export type ConversationSummary = {
  id: string;
  title: string;
  model: string;
  updatedAt: Date;
};

export type Attachment = { mediaType: string; data: string; name?: string };

export type ChatMessage = {
  id: string;
  role: string;
  content: string;
  model: string | null;
  attachments: Attachment[];
  createdAt: Date;
};

/** A user's non-archived conversations, most-recently-active first. */
export async function listConversations(
  userId: string,
): Promise<ConversationSummary[]> {
  return db
    .select({
      id: conversation.id,
      title: conversation.title,
      model: conversation.model,
      updatedAt: conversation.updatedAt,
    })
    .from(conversation)
    .where(
      and(eq(conversation.userId, userId), eq(conversation.archived, false)),
    )
    .orderBy(desc(conversation.updatedAt));
}

/** One conversation (owner-checked) or null if it isn't theirs / doesn't exist. */
export async function getConversation(id: string, userId: string) {
  const rows = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.id, id), eq(conversation.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** A conversation's messages in chronological order. */
export async function getMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  return db
    .select({
      id: message.id,
      role: message.role,
      content: message.content,
      model: message.model,
      attachments: message.attachments,
      createdAt: message.createdAt,
    })
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(asc(message.createdAt));
}

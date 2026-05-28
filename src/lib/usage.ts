import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { conversation, message, usageLedger } from "@/db/schema";
import { costMicros, estimateCostCents } from "@/lib/models";

/**
 * The usage backbone (the `usage_ledger` table built in Stage 2, written here
 * for the first time). One row per Claude call: model, tokens, computed cost in
 * cents, and free-form meta. The basis for cost limits, the Lab's history, and
 * the eventual cost-confessional.
 */

type RecordUsageArgs = {
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  meta?: Record<string, unknown>;
};

export async function recordUsage(args: RecordUsageArgs): Promise<void> {
  const costCents = estimateCostCents(args.model, args);
  const micros = costMicros(args.model, args);
  await db.insert(usageLedger).values({
    userId: args.userId,
    model: args.model,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    cacheReadTokens: args.cacheReadInputTokens ?? 0,
    cacheCreationTokens: args.cacheCreationInputTokens ?? 0,
    costCents,
    costMicros: micros,
    meta: { ...args.meta, costMicros: micros },
  });
}

/** First instant of the current calendar month, in UTC. */
function startOfMonthUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** How many messages this user has sent since `since` — for burst rate limiting. */
export async function userMessagesSince(userId: string, since: Date): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(message)
    .innerJoin(conversation, eq(message.conversationId, conversation.id))
    .where(
      and(
        eq(conversation.userId, userId),
        eq(message.role, "user"),
        gte(message.createdAt, since),
      ),
    );
  return rows[0]?.n ?? 0;
}

/** Total user messages across everyone since `since` — the public-abuse ceiling. */
export async function globalMessagesSince(since: Date): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(message)
    .where(and(eq(message.role, "user"), gte(message.createdAt, since)));
  return rows[0]?.n ?? 0;
}

/**
 * How many chat messages this user has sent this calendar month — the number
 * the free-plan cap (PLAN_LIMITS.free.monthlyMessages) is measured against. We
 * count user turns (the billable trigger), joined through their conversations.
 */
export async function monthlyMessageCount(userId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(message)
    .innerJoin(conversation, eq(message.conversationId, conversation.id))
    .where(
      and(
        eq(conversation.userId, userId),
        eq(message.role, "user"),
        gte(message.createdAt, startOfMonthUTC()),
      ),
    );
  return rows[0]?.n ?? 0;
}

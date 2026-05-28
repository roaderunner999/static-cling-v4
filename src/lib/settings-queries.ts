import { sql, eq, and, gte } from "drizzle-orm";
import { db } from "@/db";
import { user as userTable, session as sessionTable, usageLedger } from "@/db/schema";
import type { UserPreferences } from "@/db/schema";
import { deviceLabel } from "@/lib/admin-queries";
import { monthlyMessageCount } from "@/lib/usage";

/**
 * Read side of the user's own /settings page. Everything is scoped to the signed-in
 * user (never another account) and JSON-serializable for the client component.
 */

export type MyModelSpend = {
  model: string;
  calls: number;
  spendMicros: number;
  inputTokens: number;
  outputTokens: number;
};

export type MySession = {
  id: string;
  createdAt: string; // ISO
  ip: string | null;
  device: string | null;
  expiresAt: string; // ISO
  active: boolean;
};

export type MySettings = {
  preferences: UserPreferences;
  plan: string;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null; // ISO
  usage: {
    spendMicros: number;
    spendMicrosMonth: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    byModel: MyModelSpend[];
  };
  messagesThisMonth: number;
  sessions: MySession[];
};

/** Just the preferences blob — used by the chat page and home routing. */
export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  const rows = await db
    .select({ preferences: userTable.preferences })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return rows[0]?.preferences ?? {};
}

export async function getMySettings(userId: string): Promise<MySettings> {
  const now = Date.now();
  const monthStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  );

  const [userRows, usageRows, monthRows, modelRows, sessionRows, messagesThisMonth] =
    await Promise.all([
      db
        .select({
          preferences: userTable.preferences,
          plan: userTable.plan,
          subscriptionStatus: userTable.subscriptionStatus,
          currentPeriodEnd: userTable.currentPeriodEnd,
        })
        .from(userTable)
        .where(eq(userTable.id, userId))
        .limit(1),
      db
        .select({
          spendMicros: sql<number>`coalesce(sum(${usageLedger.costMicros}),0)::double precision`,
          inputTokens: sql<number>`coalesce(sum(${usageLedger.inputTokens}),0)::double precision`,
          outputTokens: sql<number>`coalesce(sum(${usageLedger.outputTokens}),0)::double precision`,
          calls: sql<number>`count(*)::int`,
        })
        .from(usageLedger)
        .where(eq(usageLedger.userId, userId)),
      // Month-to-date spend — a separate filtered query using drizzle's gte()
      // operator (it encodes the Date param correctly; raw sql interpolation of a
      // Date does not — postgres-js throws ERR_INVALID_ARG_TYPE).
      db
        .select({
          spendMicros: sql<number>`coalesce(sum(${usageLedger.costMicros}),0)::double precision`,
        })
        .from(usageLedger)
        .where(and(eq(usageLedger.userId, userId), gte(usageLedger.createdAt, monthStart))),
      db
        .select({
          model: usageLedger.model,
          calls: sql<number>`count(*)::int`,
          spendMicros: sql<number>`coalesce(sum(${usageLedger.costMicros}),0)::double precision`,
          inputTokens: sql<number>`coalesce(sum(${usageLedger.inputTokens}),0)::double precision`,
          outputTokens: sql<number>`coalesce(sum(${usageLedger.outputTokens}),0)::double precision`,
        })
        .from(usageLedger)
        .where(eq(usageLedger.userId, userId))
        .groupBy(usageLedger.model),
      db
        .select({
          id: sessionTable.id,
          createdAt: sessionTable.createdAt,
          ip: sessionTable.ipAddress,
          ua: sessionTable.userAgent,
          expiresAt: sessionTable.expiresAt,
        })
        .from(sessionTable)
        .where(eq(sessionTable.userId, userId)),
      monthlyMessageCount(userId),
    ]);

  const u = userRows[0];
  const usage = usageRows[0] ?? {
    spendMicros: 0,
    inputTokens: 0,
    outputTokens: 0,
    calls: 0,
  };
  const spendMicrosMonth = monthRows[0]?.spendMicros ?? 0;

  const byModel: MyModelSpend[] = modelRows
    .map((m) => ({
      model: m.model,
      calls: m.calls,
      spendMicros: m.spendMicros,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
    }))
    .sort((a, b) => b.spendMicros - a.spendMicros);

  const sessions: MySession[] = sessionRows
    .map((s) => ({
      id: s.id,
      createdAt: new Date(s.createdAt).toISOString(),
      ip: s.ip,
      device: deviceLabel(s.ua),
      expiresAt: new Date(s.expiresAt).toISOString(),
      active: new Date(s.expiresAt).getTime() > now,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    preferences: u?.preferences ?? {},
    plan: u?.plan ?? "free",
    subscriptionStatus: u?.subscriptionStatus ?? null,
    currentPeriodEnd: u?.currentPeriodEnd
      ? new Date(u.currentPeriodEnd).toISOString()
      : null,
    usage: { ...usage, spendMicrosMonth, byModel },
    messagesThisMonth,
    sessions,
  };
}

// `and` is imported for future scoped filters; referenced here to keep it live.
void and;

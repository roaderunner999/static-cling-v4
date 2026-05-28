import { sql, gte } from "drizzle-orm";
import { db } from "@/db";
import { user as userTable, session as sessionTable, usageLedger } from "@/db/schema";

/**
 * Read side of the admin console. Everything the page needs, fetched with a
 * handful of set-based queries and stitched together in JS — the user/session
 * tables are tiny, so this stays a few round-trips, not an N+1.
 *
 * Every value returned here is JSON-serializable (ISO strings, numbers, plain
 * objects) so it can cross the server→client boundary into <AdminConsole>.
 */

/** A user's spend split across the models they've used (precise micro-dollars). */
export type AdminModelSpend = {
  model: string;
  calls: number;
  spendMicros: number;
  inputTokens: number;
  outputTokens: number;
};

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  plan: string;
  emailVerified: boolean;
  createdAt: string; // ISO
  lastSeenAt: string | null; // ISO
  lastLoginAt: string | null; // ISO — newest session createdAt
  lastLoginIp: string | null;
  lastLoginDevice: string | null;
  activeSessions: number;
  /** All-time and month-to-date spend, in micro-dollars (USD × 1e6). */
  spendMicros: number;
  spendMicrosMonth: number;
  inputTokens: number;
  outputTokens: number;
  /** Claude calls this user has made (ledger rows: chat + router + notes-ai + …). */
  messages: number;
  byModel: AdminModelSpend[];
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null; // ISO
};

export type AdminStats = {
  totalUsers: number;
  admins: number;
  proUsers: number;
  verifiedUsers: number;
  newUsers7d: number;
  activeSessions: number;
  /** Our estimate (summed ledger), all-time and month-to-date, in micro-dollars. */
  totalSpendMicros: number;
  monthSpendMicros: number;
  mrrUsd: number;
};

export type SecurityEvent = {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  at: string; // ISO — session createdAt (≈ login time)
  ip: string | null;
  device: string | null;
  active: boolean; // not yet expired
};

export type AdminData = {
  users: AdminUserRow[];
  stats: AdminStats;
  securityLog: SecurityEvent[];
};

const iso = (d: Date | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

/** Turn a raw User-Agent string into a short "Browser on OS" label. */
export function deviceLabel(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const os = /Windows/i.test(ua)
    ? "Windows"
    : /iPhone|iPad|iOS/i.test(ua)
      ? "iOS"
      : /Mac OS X|Macintosh/i.test(ua)
        ? "macOS"
        : /Android/i.test(ua)
          ? "Android"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Unknown OS";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
      ? "Opera"
      : /Brave/i.test(ua)
        ? "Brave"
        : /Firefox\//i.test(ua)
          ? "Firefox"
          : /Chrome\//i.test(ua)
            ? "Chrome"
            : /Safari\//i.test(ua)
              ? "Safari"
              : "Browser";
  return `${browser} · ${os}`;
}

export async function getAdminData(): Promise<AdminData> {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  );
  const micros = (col: typeof usageLedger.costMicros) =>
    sql<number>`coalesce(sum(${col}),0)::double precision`;

  // Five independent reads — fire them together.
  const [users, sessions, usageRows, monthRows, modelRows] = await Promise.all([
    db.select().from(userTable),
    db
      .select({
        id: sessionTable.id,
        userId: sessionTable.userId,
        ipAddress: sessionTable.ipAddress,
        userAgent: sessionTable.userAgent,
        createdAt: sessionTable.createdAt,
        expiresAt: sessionTable.expiresAt,
      })
      .from(sessionTable),
    db
      .select({
        userId: usageLedger.userId,
        spendMicros: micros(usageLedger.costMicros),
        inputTokens: sql<number>`coalesce(sum(${usageLedger.inputTokens}),0)::double precision`,
        outputTokens: sql<number>`coalesce(sum(${usageLedger.outputTokens}),0)::double precision`,
        messages: sql<number>`count(*)::int`,
      })
      .from(usageLedger)
      .groupBy(usageLedger.userId),
    // Month-to-date spend per user — a separate query filtered with drizzle's
    // gte() operator. (Interpolating a raw Date into sql`` throws in postgres-js;
    // the operator encodes the param correctly.)
    db
      .select({
        userId: usageLedger.userId,
        spendMicrosMonth: micros(usageLedger.costMicros),
      })
      .from(usageLedger)
      .where(gte(usageLedger.createdAt, monthStart))
      .groupBy(usageLedger.userId),
    db
      .select({
        userId: usageLedger.userId,
        model: usageLedger.model,
        calls: sql<number>`count(*)::int`,
        spendMicros: micros(usageLedger.costMicros),
        inputTokens: sql<number>`coalesce(sum(${usageLedger.inputTokens}),0)::double precision`,
        outputTokens: sql<number>`coalesce(sum(${usageLedger.outputTokens}),0)::double precision`,
      })
      .from(usageLedger)
      .groupBy(usageLedger.userId, usageLedger.model),
  ]);

  const monthByUser = new Map(monthRows.map((m) => [m.userId, m.spendMicrosMonth]));

  // Index sessions per user: newest login + active count.
  type Latest = { at: Date; ip: string | null; ua: string | null };
  const latestByUser = new Map<string, Latest>();
  const activeByUser = new Map<string, number>();
  for (const s of sessions) {
    const at = new Date(s.createdAt);
    const cur = latestByUser.get(s.userId);
    if (!cur || at.getTime() > cur.at.getTime()) {
      latestByUser.set(s.userId, { at, ip: s.ipAddress, ua: s.userAgent });
    }
    if (new Date(s.expiresAt).getTime() > now) {
      activeByUser.set(s.userId, (activeByUser.get(s.userId) ?? 0) + 1);
    }
  }

  const usageByUser = new Map(usageRows.map((u) => [u.userId, u]));

  // Per-user model breakdown, biggest spend first.
  const modelsByUser = new Map<string, AdminModelSpend[]>();
  for (const m of modelRows) {
    const list = modelsByUser.get(m.userId) ?? [];
    list.push({
      model: m.model,
      calls: m.calls,
      spendMicros: m.spendMicros,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
    });
    modelsByUser.set(m.userId, list);
  }
  for (const list of modelsByUser.values()) {
    list.sort((a, b) => b.spendMicros - a.spendMicros);
  }

  const rows: AdminUserRow[] = users
    .map((u) => {
      const latest = latestByUser.get(u.id);
      const usage = usageByUser.get(u.id);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        plan: u.plan,
        emailVerified: u.emailVerified,
        createdAt: new Date(u.createdAt).toISOString(),
        lastSeenAt: iso(u.lastSeenAt),
        lastLoginAt: latest ? latest.at.toISOString() : null,
        lastLoginIp: latest?.ip ?? null,
        lastLoginDevice: deviceLabel(latest?.ua),
        activeSessions: activeByUser.get(u.id) ?? 0,
        spendMicros: usage?.spendMicros ?? 0,
        spendMicrosMonth: monthByUser.get(u.id) ?? 0,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        messages: usage?.messages ?? 0,
        byModel: modelsByUser.get(u.id) ?? [],
        subscriptionStatus: u.subscriptionStatus,
        currentPeriodEnd: iso(u.currentPeriodEnd),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const stats: AdminStats = {
    totalUsers: rows.length,
    admins: rows.filter((r) => r.role === "admin").length,
    proUsers: rows.filter((r) => r.plan === "pro").length,
    verifiedUsers: rows.filter((r) => r.emailVerified).length,
    newUsers7d: users.filter((u) => new Date(u.createdAt).getTime() > sevenDaysAgo)
      .length,
    activeSessions: sessions.filter((s) => new Date(s.expiresAt).getTime() > now)
      .length,
    totalSpendMicros: rows.reduce((sum, r) => sum + r.spendMicros, 0),
    monthSpendMicros: rows.reduce((sum, r) => sum + r.spendMicrosMonth, 0),
    mrrUsd: rows.filter((r) => r.plan === "pro").length * 8,
  };

  const nameById = new Map(users.map((u) => [u.id, { name: u.name, email: u.email }]));
  const securityLog: SecurityEvent[] = sessions
    .map((s) => {
      const who = nameById.get(s.userId);
      return {
        sessionId: s.id,
        userId: s.userId,
        name: who?.name ?? "—",
        email: who?.email ?? "—",
        at: new Date(s.createdAt).toISOString(),
        ip: s.ipAddress,
        device: deviceLabel(s.userAgent),
        active: new Date(s.expiresAt).getTime() > now,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 30);

  return { users: rows, stats, securityLog };
}

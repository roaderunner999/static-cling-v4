import { sql } from "drizzle-orm";
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
  spendCents: number;
  messages: number;
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
  totalSpendCents: number;
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

  // Three independent reads — fire them together.
  const [users, sessions, usageRows] = await Promise.all([
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
        spendCents: sql<number>`coalesce(sum(${usageLedger.costCents}), 0)::int`,
        messages: sql<number>`count(*)::int`,
      })
      .from(usageLedger)
      .groupBy(usageLedger.userId),
  ]);

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

  const usageByUser = new Map(
    usageRows.map((u) => [u.userId, { spendCents: u.spendCents, messages: u.messages }]),
  );

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
        spendCents: usage?.spendCents ?? 0,
        messages: usage?.messages ?? 0,
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
    totalSpendCents: rows.reduce((sum, r) => sum + r.spendCents, 0),
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

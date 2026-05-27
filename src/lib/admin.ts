import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { adminEmails } from "@/env";

/**
 * Admin authorization — the single source of truth for "is this user an admin?"
 *
 * A user is an admin if EITHER:
 *   - their `user.role` column is "admin" (set by the admin console / seed), OR
 *   - their email is in the ADMIN_EMAILS allowlist (env-controlled safety net).
 *
 * The allowlist means the owner can never be locked out of /admin even if the
 * role column gets toggled by accident. Server-only (reads server env).
 */

/** Minimal shape we need to reason about admin access. */
export type AdminUser = { email: string; role?: string | null };

export function isAdmin(user: AdminUser): boolean {
  if (user.role === "admin") return true;
  return adminEmails.has(user.email.trim().toLowerCase());
}

/**
 * Gate a server component or server action on admin access.
 *
 * Signed-out → /login. Signed-in non-admins get a 404 (notFound) rather than a
 * redirect, so the console's very existence isn't advertised to normal users.
 * Returns the live `{ user, session }` so callers can use the admin's id.
 */
export async function requireAdmin() {
  const session = await getSession();
  if (!session) redirect("/login?redirect=/admin");
  if (!isAdmin(session.user)) notFound();
  return session;
}

"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user as userTable, session as sessionTable } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { auth } from "@/lib/auth";
import { emailEnabled } from "@/env";

/**
 * Admin mutations — Server Actions, invoked from <AdminConsole>. Like billing,
 * they travel through `/` (no custom /api route) so they sidestep the nginx
 * `/api/ -> :8080` shadow. EVERY action re-checks admin authorization with
 * requireAdmin() first, because Server Actions are reachable by direct POST,
 * not just through our UI.
 */

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

const updateSchema = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(1, "Name can’t be empty").max(200),
  email: z.string().trim().toLowerCase().email("That isn’t a valid email"),
  plan: z.enum(["free", "pro"]),
  role: z.enum(["user", "admin"]),
  emailVerified: z.boolean(),
});

export type UpdateUserInput = z.infer<typeof updateSchema>;

/** Edit a user's profile fields (name, email, plan, role, verified). */
export async function updateUserAction(
  input: UpdateUserInput,
): Promise<ActionResult> {
  const { user: me } = await requireAdmin();

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  // Foot-gun guard: don't let an admin strip their own admin role and lock
  // themselves out from the UI. (The ADMIN_EMAILS allowlist is a deeper net.)
  if (data.userId === me.id && data.role !== "admin") {
    return { ok: false, error: "You can’t remove your own admin role." };
  }

  try {
    await db
      .update(userTable)
      .set({
        name: data.name,
        email: data.email,
        plan: data.plan,
        role: data.role,
        emailVerified: data.emailVerified,
        updatedAt: new Date(),
      })
      .where(eq(userTable.id, data.userId));
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: "That email is already in use by another account." };
    }
    return { ok: false, error: "Couldn’t save changes. Please try again." };
  }

  revalidatePath("/admin");
  return { ok: true, message: "Saved." };
}

/** Revoke every session for a user — force-signs them out everywhere. */
export async function revokeSessionsAction(
  userId: string,
): Promise<ActionResult> {
  await requireAdmin();
  if (!userId) return { ok: false, error: "Missing user." };

  const deleted = await db
    .delete(sessionTable)
    .where(eq(sessionTable.userId, userId))
    .returning({ id: sessionTable.id });

  revalidatePath("/admin");
  return {
    ok: true,
    message:
      deleted.length === 0
        ? "No active sessions to revoke."
        : `Signed out of ${deleted.length} session${deleted.length === 1 ? "" : "s"}.`,
  };
}

/**
 * Trigger a password-reset email to the user. Reset email needs Resend wired
 * (RESEND_API_KEY) plus the sendResetPassword handler — both documented as a
 * drop-in in deploy/STAGE-1-AUTH.md. Until then this reports honestly instead
 * of pretending to send.
 */
export async function sendPasswordResetAction(
  userId: string,
): Promise<ActionResult> {
  await requireAdmin();

  const rows = await db
    .select({ email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  const email = rows[0]?.email;
  if (!email) return { ok: false, error: "User not found." };

  if (!emailEnabled) {
    return {
      ok: false,
      error:
        "Email isn’t configured yet (no Resend key). Add RESEND_API_KEY + the reset handler (see deploy/STAGE-1-AUTH.md) to enable reset emails.",
    };
  }

  try {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "/login" },
    });
    return { ok: true, message: `Reset email sent to ${email}.` };
  } catch {
    return {
      ok: false,
      error:
        "Couldn’t send the reset email — the reset handler may not be wired yet (see deploy/STAGE-1-AUTH.md).",
    };
  }
}

/** Permanently delete a user and everything that cascades from them. */
export async function deleteUserAction(userId: string): Promise<ActionResult> {
  const { user: me } = await requireAdmin();
  if (!userId) return { ok: false, error: "Missing user." };
  if (userId === me.id) {
    return { ok: false, error: "You can’t delete your own account here." };
  }

  await db.delete(userTable).where(eq(userTable.id, userId));

  revalidatePath("/admin");
  return { ok: true, message: "Account deleted." };
}

/** Postgres unique-constraint violation (e.g. duplicate email). */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === "23505") return true;
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return msg.includes("duplicate") || msg.includes("unique");
}

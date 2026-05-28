"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user as userTable, session as sessionTable } from "@/db/schema";
import type { UserPreferences } from "@/db/schema";
import { getSession } from "@/lib/session";
import { isKnownModel } from "@/lib/models";

/**
 * The signed-in user's own settings mutations — Server Actions (so they travel
 * through `/`, sidestepping the nginx `/api/ -> :8080` shadow). Every action
 * re-reads the session and only ever touches the caller's own row.
 */

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

const profileSchema = z.object({
  name: z.string().trim().min(1, "Name can’t be empty").max(200),
});

/** Update the caller's display name. */
export async function updateMyProfile(input: {
  name: string;
}): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await db
    .update(userTable)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(userTable.id, session.user.id));

  revalidatePath("/settings");
  return { ok: true, message: "Profile saved." };
}

const prefsSchema = z.object({
  defaultModel: z
    .string()
    .refine((m) => m === "auto" || isKnownModel(m), "Unknown model"),
  defaultView: z.enum(["dashboard", "chat"]),
});

/** Update the caller's preferences (default chat model + default landing view). */
export async function updateMyPreferences(
  input: UserPreferences,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const parsed = prefsSchema.safeParse({
    defaultModel: input.defaultModel ?? "auto",
    defaultView: input.defaultView ?? "dashboard",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await db
    .update(userTable)
    .set({ preferences: parsed.data, updatedAt: new Date() })
    .where(eq(userTable.id, session.user.id));

  revalidatePath("/settings");
  return { ok: true, message: "Preferences saved." };
}

/** Sign out everywhere except this device (delete the caller's other sessions). */
export async function revokeMyOtherSessions(): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const deleted = await db
    .delete(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, session.user.id),
        ne(sessionTable.id, session.session.id),
      ),
    )
    .returning({ id: sessionTable.id });

  revalidatePath("/settings");
  return {
    ok: true,
    message:
      deleted.length === 0
        ? "No other sessions to sign out."
        : `Signed out of ${deleted.length} other session${deleted.length === 1 ? "" : "s"}.`,
  };
}

/**
 * Permanently delete the caller's own account (typed-email confirmation). The
 * cascade removes their sessions, conversations, notes, tasks, and usage; the
 * now-stale session cookie leaves them signed out, so we redirect home.
 */
export async function deleteMyAccount(confirmEmail: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  if (confirmEmail.trim().toLowerCase() !== session.user.email.toLowerCase()) {
    return { ok: false, error: "Email didn’t match — account not deleted." };
  }

  await db.delete(userTable).where(eq(userTable.id, session.user.id));
  redirect("/");
}

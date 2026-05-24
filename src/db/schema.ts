import { pgTable, uuid, timestamp } from "drizzle-orm/pg-core";

/**
 * Stage 0 placeholder.
 *
 * This intentionally minimal `users` table exists only to prove the Drizzle
 * migration pipeline end-to-end (generate -> migrate -> live table) before we
 * trust it with real schemas. Stage 1 (Better Auth) replaces and expands this
 * with real columns: email, name, avatar, created_at, last_seen_at, plan,
 * feature flags, etc.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

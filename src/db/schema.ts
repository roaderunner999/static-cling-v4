import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";

/**
 * Stage 1 — Auth schema (Better Auth + Drizzle).
 *
 * These four tables are the canonical Better Auth core schema (user, session,
 * account, verification). Names and columns match what Better Auth's Drizzle
 * adapter expects, so `drizzleAdapter(db, { provider: "pg", schema })` maps to
 * them by key. A few app-owned columns are layered onto `user` for the road
 * ahead (plan/billing, presence, feature flags).
 *
 * IDs are `text`, not `uuid`: Better Auth generates its own string IDs. The
 * Stage 0 placeholder `users` table (uuid) is replaced by this `user` table.
 *
 * Timestamps use `mode: "date"` so Drizzle hands Better Auth real `Date`
 * objects (and stores them as `timestamptz`), which is what the adapter passes.
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" })
    .$defaultFn(() => new Date())
    .notNull();

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .$defaultFn(() => new Date())
    .notNull();

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),

  // --- App-owned columns (not managed by Better Auth core) ---
  // Access role: "user" (default) or "admin". Admins reach /admin and the
  // account console. Also declared as a Better Auth additionalField so it is
  // typed on the session user. The admin set is the union of this column and
  // the ADMIN_EMAILS allowlist (see src/lib/admin.ts) — belt and suspenders.
  role: text("role").notNull().default("user"),
  // Billing plan; Stage 2 (Stripe) drives this. `plan` is also declared as a
  // Better Auth additionalField so it is typed on the session user.
  plan: text("plan").notNull().default("free"),
  // Presence; updated by the app on activity.
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
  // Per-user feature flags, e.g. { "lab": true }.
  featureFlags: jsonb("feature_flags")
    .$type<Record<string, boolean>>()
    .notNull()
    .default({}),

  // --- Billing (Stage 2, Stripe) ---
  // Set the first time the user starts checkout; reused thereafter.
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Mirror of the Stripe subscription status (active, trialing, canceled, …).
  subscriptionStatus: text("subscription_status"),
  // When the current paid period ends (renewal / expiry).
  currentPeriodEnd: timestamp("current_period_end", {
    withTimezone: true,
    mode: "date",
  }),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
    mode: "date",
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
    mode: "date",
  }),
  scope: text("scope"),
  // Hashed password for email/password accounts (null for OAuth accounts).
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Per-user Claude usage ledger (Stage 2 backbone). One row per Claude API call,
 * written by the app from Stage 3 onward. The basis for cost limits, the Lab's
 * history, and the "cost-confessional". App-owned (Better Auth never touches it),
 * so we generate the id ourselves.
 */
export const usageLedger = pgTable("usage_ledger", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // The model and token counts of a single Claude call.
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  // Computed cost of the call in US cents (integer, for exactness).
  costCents: integer("cost_cents").notNull().default(0),
  // Free-form context, e.g. { feature: "chat", widgetId: "…" }.
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});


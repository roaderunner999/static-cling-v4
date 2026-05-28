import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  bigint,
  index,
} from "drizzle-orm/pg-core";

/** Per-user preferences, surfaced on the typed session user and the settings page. */
export type UserPreferences = {
  /** Chat model the picker opens to for new conversations: "auto" or a model id. */
  defaultModel?: string;
  /** What the logged-in "/" opens to. */
  defaultView?: "dashboard" | "chat";
};

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
  // User-settable preferences (default chat model, default landing view). Edited
  // from /settings; surfaced on the typed session user via a Better Auth field.
  preferences: jsonb("preferences")
    .$type<UserPreferences>()
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
  // Cache tokens Anthropic bills separately (reads at ~0.1×, 5-min writes at
  // ~1.25× the input rate). Stored so cost can be recomputed/re-priced exactly.
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
  // Computed cost in whole US cents — kept for back-compat / coarse views, but
  // it rounds sub-cent calls to 0. Prefer costMicros for anything that sums.
  costCents: integer("cost_cents").notNull().default(0),
  // Computed cost in MICRO-dollars (USD × 1,000,000) — the precise unit. Sub-cent
  // calls (Haiku, the auto-router, short turns) no longer vanish to 0 here, so
  // sums are accurate. estimateCostCents stays for the legacy column.
  costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
  // Free-form context, e.g. { feature: "chat", widgetId: "…" }.
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

/**
 * Stage 3 — Chat. A `conversation` is one thread; `message` rows are its turns.
 * Both are app-owned (Better Auth never touches them), so we generate the ids.
 * The legacy single-file app kept the transcript in localStorage; v4 persists it
 * to Postgres so it follows the account across devices and feeds the usage ledger.
 *
 * `conversation.model` records the model the thread was last sent with (a chat
 * can switch models mid-thread; this is just the current default for new turns).
 */
export const conversation = pgTable(
  "conversation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    // The model id this thread defaults to (e.g. "claude-sonnet-4-6").
    model: text("model").notNull().default("claude-sonnet-4-6"),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conversation_user_idx").on(t.userId, t.updatedAt)],
);

export const message = pgTable(
  "message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    // "user" or "assistant".
    role: text("role").notNull(),
    content: text("content").notNull(),
    // The model that produced an assistant turn; null on user turns.
    model: text("model"),
    // Image attachments on a user turn (Stage 3c). Each is base64 + media type so
    // it round-trips to Claude's vision and re-renders as a thumbnail on reload.
    attachments: jsonb("attachments")
      .$type<{ mediaType: string; data: string; name?: string }[]>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
  },
  (t) => [index("message_conversation_idx").on(t.conversationId, t.createdAt)],
);

/**
 * Stage 3b — Notes. One row per note. `doc` is the canonical Tiptap (ProseMirror)
 * JSON document; `plainText` is its flattened text, kept for list previews, future
 * search, and as the clean payload for AI features (the →TO CHAT bridge, summarize,
 * rewrite). Storing both means the editor round-trips losslessly while everything
 * else that just needs the words reads `plainText`.
 */
export const note = pgTable(
  "note",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Untitled"),
    doc: jsonb("doc").$type<Record<string, unknown>>().notNull().default({}),
    plainText: text("plain_text").notNull().default(""),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("note_user_idx").on(t.userId, t.updatedAt)],
);

/**
 * Stage 4-ish — Tasks. A personal task board ported from the legacy localStorage
 * app, now persisted per-account in Postgres so it syncs across devices.
 * status ∈ todo|doing|done, priority ∈ low|medium|high, goal is a free-text
 * grouping, checklist is a small array of {text, done} subtasks.
 */
export const task = pgTable(
  "task",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    goal: text("goal").notNull().default(""),
    status: text("status").notNull().default("todo"),
    priority: text("priority").notNull().default("medium"),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }),
    checklist: jsonb("checklist")
      .$type<{ text: string; done: boolean }[]>()
      .notNull()
      .default([]),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("task_user_idx").on(t.userId, t.updatedAt)],
);


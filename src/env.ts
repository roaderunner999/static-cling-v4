import { z } from "zod";

/**
 * Validated environment variables.
 *
 * We validate at the point of first use and fail fast with a readable error if
 * anything required is missing or malformed. Import this `env` object instead
 * of reading `process.env` directly so that a typo or a missing secret surfaces
 * immediately rather than as a runtime `undefined` three layers deep.
 *
 * This module is server-only by convention — do not import it into client
 * components (it would leak secrets into the browser bundle). The Better Auth
 * client reads nothing from here; it talks to /api/auth on the same origin.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Postgres connection string. Stage 0 runs a local Postgres on the
  // DigitalOcean droplet (no external pooler yet — PgBouncer is deferred until
  // traffic warrants it). Local dev -> staticcling_dev, prod -> staticcling_v4.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // --- Better Auth (Stage 1) ---
  // Signs sessions/tokens. Generate with: openssl rand -base64 32
  BETTER_AUTH_SECRET: z
    .string()
    .min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),
  // Public base URL of the app. Dev default below; in prod set this to
  // https://static-cling.com so callback URLs and cookies resolve correctly.
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),

  // --- Admin console ---
  // Comma-separated allowlist of emails that always have admin access,
  // independent of the `user.role` column. A safety net so the owner can never
  // be locked out of /admin even if the role gets toggled. Defaults to the
  // owner account; override on the box to add/replace admins.
  ADMIN_EMAILS: z.string().default("admin@lyons.net"),

  // --- Optional providers (drop-in: present a value to activate) ---
  // Google OAuth — social sign-in lights up automatically when both are set.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Resend — transactional email (magic links, verification, password reset).
  // When RESEND_API_KEY is set, the email-backed flows activate.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Static Cling <onboarding@static-cling.com>"),

  // --- Stripe billing (Stage 2) ---
  // Server-side secret key (sk_test_… in dev, sk_live_… at launch).
  STRIPE_SECRET_KEY: z.string().optional(),
  // Webhook signing secret (whsec_…) for /api/stripe/webhook.
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Stripe Price ID for the Pro plan (price_…), created in the dashboard.
  STRIPE_PRICE_ID: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "\n❌ Invalid or missing environment variables:\n" +
      JSON.stringify(parsed.error.issues, null, 2) +
      "\n",
  );
  throw new Error("Invalid environment variables — see the log above.");
}

export const env = parsed.data;

/**
 * Normalized admin allowlist (lowercased, trimmed, de-duped). The union of this
 * and the `user.role = 'admin'` column decides admin access — see isAdmin().
 */
export const adminEmails = new Set(
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/** True when Google OAuth credentials are configured. */
export const googleEnabled = Boolean(
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
);

/** True when transactional email (Resend) is configured. */
export const emailEnabled = Boolean(env.RESEND_API_KEY);

/** True when Stripe billing is fully configured (secret key + Pro price). */
export const billingEnabled = Boolean(
  env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID,
);

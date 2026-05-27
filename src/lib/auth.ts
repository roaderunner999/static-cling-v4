import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import { account, session, user, verification } from "@/db/schema";
import { env, googleEnabled } from "@/env";

/**
 * Better Auth server instance (Stage 1).
 *
 * Server-only — never import this into a client component. Client code talks to
 * it over /api/auth via the Better Auth client in `@/lib/auth-client`.
 *
 * What's live now (no external keys required):
 *   - Email + password sign-up / sign-in / sign-out, with sessions.
 *   - Google OAuth, which activates automatically when GOOGLE_CLIENT_ID and
 *     GOOGLE_CLIENT_SECRET are present (Google is built into Better Auth core).
 *
 * Drop-in slots documented in deploy/STAGE-1-AUTH.md (need keys + 1 package):
 *   - Magic-link sign-in and email verification / password reset via Resend.
 *   - Flip emailAndPassword.requireEmailVerification on once email works.
 */
export const auth = betterAuth({
  appName: "Static Cling",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
    // No email transport configured yet, so don't gate sign-in on verification.
    // Set to true after Resend is wired (see STAGE-1-AUTH.md) for real launch.
    requireEmailVerification: false,
  },

  // Google OAuth — only registered when both credentials exist, so the keyless
  // build stays valid and social sign-in lights up the moment keys are added.
  ...(googleEnabled
    ? {
        socialProviders: {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
          },
        },
      }
    : {}),

  user: {
    additionalFields: {
      // App-owned billing plan, surfaced on the typed session user. Stage 2
      // (Stripe) writes this; users can't set it on sign-up (input: false).
      plan: {
        type: "string",
        required: false,
        defaultValue: "free",
        input: false,
      },
      // Access role, surfaced on the typed session user so pages can branch on
      // session.user.role without a second query. Never user-settable on
      // sign-up (input: false); only the admin console / seed migration writes it.
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },

  // nextCookies() must be the LAST plugin so it can attach Set-Cookie headers
  // after every other plugin has run.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

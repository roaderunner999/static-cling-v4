# Stage 1 — Auth & user accounts

Built 2026-05-26. Better Auth (v1.6.11) on the existing Postgres, email + password,
sessions, and a profile page. Verified locally as far as a database-free machine
allows: **typecheck ✓, lint ✓, migrations generated ✓, `next build` ✓.** What is
*not* yet verified is a real signup against a live database — that needs the box.

---

## What shipped (live now, no keys required)

- **Email + password** sign-up / sign-in / sign-out, with sessions (`autoSignIn`,
  8-char minimum, email verification *not* required yet — see "Email" below).
- **Pages:** `/signup`, `/login`, `/profile` (protected), and a session-aware `/`.
- **Route protection:** `src/proxy.ts` (Next 16's renamed middleware, Node runtime)
  optimistically bounces signed-out visitors off `/profile` and `/dashboard/*`.
- **Server session access:** `getSession()` in `src/lib/session.ts`.
- **Schema:** the Stage 0 placeholder `users` table is replaced by Better Auth's
  `user` / `session` / `account` / `verification` tables, with extra app columns on
  `user`: `plan` (default `free`), `last_seen_at`, `feature_flags` (jsonb).

## What's scaffolded but dark (needs keys — ask and I'll wire/verify)

- **Google OAuth** — *code is already in place*, gated on env. Add two keys, done.
- **Resend email** (magic-link, verification, password reset) — needs 1 package +
  a short code block, both below.

---

## Deploy it (your normal FileZilla flow)

The migration and the new auth secret are now handled by `deploy/golive.sh`
automatically — you don't have to hand-edit anything on the box.

1. **Build the upload bundle** locally (same as Stage 0): the project minus
   `node_modules`/`.next`. Upload it to `/opt/static-cling-v4/` on the droplet via
   FileZilla, replacing the old files (keep the box's existing `.env`).
2. **Run golive** on the box (DigitalOcean web console, as root):
   ```
   cd /opt/static-cling-v4 && bash deploy/golive.sh
   ```
   It will: ensure the DB, **write `BETTER_AUTH_SECRET` into `.env` (generated once,
   preserved on re-runs)**, `npm ci`, **`npm run db:migrate`** (drop placeholder →
   create auth tables), `npm run build`, restart the service, and only then touch
   nginx — with the same auto-revert safety as Stage 0.

### ⚠ One safety check before the migration (lesson from the bogeyman job)

Migration `0001` runs `DROP TABLE "users" CASCADE`. That table is the Stage 0
*placeholder* and should be **empty** — but confirm it rather than trust the label:

```
sudo -u postgres psql -d staticcling_v4 -tAc 'SELECT count(*) FROM users;'
```

Expected: `0`. If it's `0` (it will be — there was no signup flow until now), the
drop loses nothing. If it's somehow not `0`, **stop** and tell me before proceeding.

### Milestone to confirm it works

Visit `https://static-cling.com/signup`, create an account, you land on `/profile`,
sign out, sign back in at `/login`. That's the Stage 1 milestone met on real infra.

---

## Activating Google OAuth (just keys — no code change)

1. Google Cloud Console → Credentials → **OAuth 2.0 Client ID** (Web application).
2. Authorized redirect URI:
   ```
   https://static-cling.com/api/auth/callback/google
   ```
3. Put the two values in the box's `.env` (uncomment the lines golive.sh left):
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
4. `systemctl restart static-cling-v4`. A "Continue with Google" button appears on
   `/login` and `/signup` automatically.

> Hand me those two keys whenever you have them and I'll verify the round-trip.

## Activating email — Resend (magic-link, verification, password reset)

Needs one package and a short wiring block. Ask me and I'll apply + verify it; the
exact changes are:

1. `npm i resend`
2. New `src/lib/email.ts`:
   ```ts
   import { Resend } from "resend";
   import { env } from "@/env";
   const resend = new Resend(env.RESEND_API_KEY);
   export async function sendEmail(to: string, subject: string, html: string) {
     await resend.emails.send({ from: env.EMAIL_FROM, to, subject, html });
   }
   ```
3. In `src/lib/auth.ts`, add to `emailAndPassword`:
   ```ts
   requireEmailVerification: true,
   sendResetPassword: async ({ user, url }) =>
     sendEmail(user.email, "Reset your Static Cling password",
       `<p><a href="${url}">Reset your password</a></p>`),
   ```
   and add the magic-link plugin (before `nextCookies()`):
   ```ts
   import { magicLink } from "better-auth/plugins/magic-link";
   // ...plugins: [ magicLink({ sendMagicLink: async ({ email, url }) =>
   //   sendEmail(email, "Your Static Cling sign-in link",
   //     `<p><a href="${url}">Sign in</a></p>`) }), nextCookies() ]
   ```
4. Client: add `magicLinkClient()` to `createAuthClient` in `src/lib/auth-client.ts`
   (`import { magicLinkClient } from "better-auth/client/plugins"`).
5. Put `RESEND_API_KEY=...` (and verify `EMAIL_FROM`) in `.env`, restart.

> Hand me the Resend key and I'll do steps 1–5 and verify a real email.

---

## Local dev (optional — to test signup on your own machine)

There's no local Postgres here, so signup can't be exercised locally yet. To enable
it: install Postgres, create `staticcling_dev`, set `DATABASE_URL` in `.env.local`,
then `npm run db:migrate && npm run dev`. Not required — the box is the real target.

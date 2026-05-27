# Admin console — handoff

A real admin area at **`/admin`** for managing accounts. Built on the existing
Stage 1/2 plumbing (Better Auth sessions, Drizzle, server actions). Owner-only.

## What you get

- **`/admin`** dashboard, linked from `/profile` (the violet "Admin console →"
  button shows only for admins).
- **Stat cards:** total users, Pro count + MRR estimate, verified ratio, new
  signups in the last 7 days, active sessions, all-time Claude spend.
- **Users table:** name/email, role + plan badges, last login (relative), last
  IP + device (parsed from the session User-Agent), live session count, spend.
  Click any row to open the editor.
- **Edit drawer:** change **name, email, role (user/admin), plan (free/pro),
  email-verified**. Read-only facts: user id, member since, last seen, last
  login time/IP/device, active sessions, subscription status + renewal, usage.
- **Account actions:** *Send password-reset email* (gated — see below),
  *Force sign-out* (revokes all the user's sessions).
- **Danger zone:** delete an account (type the email to confirm; cascades to
  sessions/accounts/usage). You can't delete or de-admin **yourself**.
- **Recent logins** security log (last 30 sessions: who, when, IP, device,
  active/expired).
- **Export CSV** of all users (client-side, one click).

## Who is an admin

A user is admin if **either** their `user.role = 'admin'` **or** their email is
in the **`ADMIN_EMAILS`** allowlist (env). The allowlist is the safety net so
the owner can never be locked out. `admin@lyons.net` is covered both ways:

- Migration `0004` seeds `role = 'admin'` for that email.
- `ADMIN_EMAILS` defaults to `admin@lyons.net` (golive falls back to it).

To add another admin: edit their role in the console, **or** add their email to
`ADMIN_EMAILS` in the box `.env` and restart. Non-admins who hit `/admin` get a
404 (the page doesn't advertise its existence).

## Schema change

Migration **`0004_third_sharon_carter.sql`** — additive, on top of `0003`:

```sql
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;
UPDATE "user" SET "role" = 'admin' WHERE lower("email") = 'admin@lyons.net';
```

Applied on the box by `golive.sh` (`npm run db:migrate`). Nothing to do by hand.

## Deploy

Same flow as Stage 1/2 — **no new nginx blocks needed** (admin reads happen in
the server component; all writes are **server actions** through `/`, so they
dodge the `/api/ -> :8080` shadow):

1. Build the bundle (excludes node_modules/.next/.git/.env.local).
2. FileZilla `static-cling-v4-admin.tar.gz` → `/root/` on the droplet.
3. On the box:
   ```bash
   tar xzf /root/static-cling-v4-admin.tar.gz -C /opt/static-cling-v4 \
     && chown -R walt:walt /opt/static-cling-v4 \
     && cd /opt/static-cling-v4 && bash deploy/golive.sh
   ```
   `golive.sh` preserves all keys, adds `ADMIN_EMAILS` (defaults to the owner),
   applies migration `0004`, rebuilds, restarts, and auto-reverts nginx on any
   failure.
4. Visit `https://static-cling.com/admin` (behind the site password as always).

## Note on "Send password-reset email"

Reset email needs Resend wired (`RESEND_API_KEY`) **and** the `sendResetPassword`
handler — both are documented drop-ins in `STAGE-1-AUTH.md`. Until that's in,
the button is disabled and labelled "(email not configured)", and the action
reports honestly rather than pretending to send. Once email is wired it calls
Better Auth's `requestPasswordReset` for the selected user. Per the brief,
password is otherwise N/A here — admins don't set passwords, users reset their own.

## Files

- `src/db/schema.ts` — `role` column on `user`.
- `src/lib/auth.ts` — `role` as a Better Auth additionalField (typed on session).
- `src/env.ts` — `ADMIN_EMAILS` + normalized `adminEmails` set.
- `src/lib/admin.ts` — `isAdmin()` / `requireAdmin()`.
- `src/lib/admin-queries.ts` — read side (users + stats + security log).
- `src/lib/admin-actions.ts` — server actions (update / revoke / reset / delete).
- `src/app/admin/page.tsx` — the page (`requireAdmin`, `force-dynamic`).
- `src/components/admin-console.tsx` — the UI.
- `src/proxy.ts` — `/admin` added to the optimistic cookie gate.
- `src/app/profile/page.tsx` — the admin link.
- `deploy/golive.sh`, `.env.example` — `ADMIN_EMAILS` wiring.

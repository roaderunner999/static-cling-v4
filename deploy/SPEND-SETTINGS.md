# Build 4.2.0 — Real spend + User settings

Three things landed together this build:

1. **Spend accuracy** — the ledger now stores cost at **micro-dollar precision**, so
   cheap calls (Haiku, the auto-router, short turns) no longer round to `$0`. The
   admin "Claude spend" and the Lab numbers stop under-reporting.
2. **Real spend from Anthropic** — the admin console pulls the org's **actual billed
   spend** from the Usage & Cost API and reconciles it against our estimate. Lights
   up when you add an Admin key (env-gated, honest "estimate only" state until then).
3. **User settings area** — a real `/settings` page (profile, usage, plan & billing,
   preferences, security, delete account).

---

## What you must do

### 1. Deploy (applies the migration — run golive, not just restart)

This build adds **migration `0009_peaceful_overlord.sql`** (additive: new ledger
columns `cost_micros` / `cache_read_tokens` / `cache_creation_tokens`, a `preferences`
column on `user`, and a backfill that recomputes `cost_micros` for existing rows). So
you must **re-run golive**, not just restart the service.

```
# upload static-cling-v4-spend-settings.tar.gz to /root via FileZilla, then on the box:
tar xzf /root/static-cling-v4-spend-settings.tar.gz -C /opt/static-cling-v4
chown -R walt:walt /opt/static-cling-v4
bash /opt/static-cling-v4/deploy/golive.sh
```

No nginx change this build (settings + admin are server actions / server components —
no new `/api/*` route). golive preserves all your keys as usual.

### 2. (Optional) Turn on real Anthropic spend

Without this, the admin console shows our estimate (now precise) and a calm prompt to
connect billing. To show Anthropic's **actual billed** numbers:

1. In the Claude Console → **Settings → Admin keys**, mint a key that starts with
   `sk-ant-admin…`. This is **different** from the chat key (`ANTHROPIC_API_KEY`) and
   can only be created by an org admin. Your account (Lyons Software) is an org, so
   you can.
2. On the box, add it to `/opt/static-cling-v4/.env`:
   ```
   ANTHROPIC_ADMIN_KEY=sk-ant-admin...
   ```
   (golive also has a slot for it and preserves it across re-runs.)
3. `systemctl restart static-cling-v4` (or re-run golive).

Honest caveats, shown in the UI too:
- **There is no "remaining balance" API.** Anthropic exposes *spend*, not the
  $-credit-left number from the billing page. We show billed spend only.
- The Cost API is **org-wide** (every API key on the org), while our estimate is just
  this app. They won't match until the app's key lives in its **own workspace** — then
  the Cost API can be filtered to it. (This is also the foundation for the VIP idea —
  a workspace per power-user gives real, Anthropic-sourced per-user spend.)
- **Per-user spend is always our estimate.** Anthropic bills the org, not your
  end-users, so it can't break spend down by your app's users.

---

## What changed (files)

- `src/db/schema.ts` — `usage_ledger.cost_micros` (bigint µ$) + `cache_read_tokens` +
  `cache_creation_tokens`; `user.preferences` (jsonb).
- `drizzle/0009_peaceful_overlord.sql` — the additive migration + backfill.
- `src/lib/models.ts` — `costMicros()` + `formatUsd()` (sub-cent-aware).
- `src/lib/usage.ts` — `recordUsage` writes micros + cache columns.
- `src/lib/lab-queries.ts` + `src/app/lab/page.tsx` — switched to micros.
- `src/lib/anthropic-admin.ts` — **NEW.** Pulls `/v1/organizations/cost_report`
  (paginated, 5-min in-memory cache, honest errors, workspace-aware).
- `src/env.ts` — `ANTHROPIC_ADMIN_KEY` + `adminApiEnabled`.
- `deploy/golive.sh` — preserves + writes `ANTHROPIC_ADMIN_KEY`.
- `src/lib/admin-queries.ts` + `src/components/admin-console.tsx` + `src/app/admin/page.tsx`
  — per-user precise spend, month-vs-all-time toggle, per-model breakdown drawer, the
  Anthropic reconciliation card.
- `src/lib/settings-queries.ts` + `src/lib/settings-actions.ts` — **NEW.** The user's
  own usage/preferences/sessions + profile/prefs/sign-out-others/delete-account actions.
- `src/app/settings/page.tsx` + `src/components/settings-ui.tsx` — **NEW.** The page.
- `src/components/site-header.tsx` — header link now points to **Settings**.
- `src/app/page.tsx` — honors `defaultView=chat` (redirects home → /chat).
- `src/app/chat/page.tsx` + `src/components/chat-ui.tsx` — chat opens to the user's
  preferred `defaultModel`.

## Verify on the box (no local DB here, so this wasn't runtime-tested locally)

- `/settings` loads; edit name → Save; change default model + "open to" → Save, then
  reload home (chat-first) / open a new chat (model preselected).
- Admin console: spend numbers look right; toggle All time / This month; open a user →
  per-model breakdown shows. With the admin key set, the "Real spend from Anthropic"
  card shows actual numbers + reconciliation; without it, the estimate-only prompt.
- Security: "Sign out other devices" works; delete-account flow (use a throwaway test
  user, not yourself).

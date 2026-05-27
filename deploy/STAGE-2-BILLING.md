# Stage 2 — Subscriptions & billing (Stripe)

Built 2026-05-26. A single **Pro — $8/mo** plan via Stripe Checkout + Customer
Portal, a webhook that mirrors subscription state onto the user, an entitlements
gate (`canUserDoThis`), and the per-user **usage ledger** table (backbone for
Stage 3+). Verified locally: **typecheck ✓, lint ✓, migration generated ✓,
`next build` ✓.** Not yet verified: a real checkout — that needs the box + your
Stripe test keys (steps below).

---

## What shipped

- **Plan model** (`src/lib/billing.ts`): `free` vs `pro`. Free = 50 Claude
  msgs/mo, no Lab, no scheduled widgets. Pro = 2000/mo + Lab + scheduled widgets.
  All numbers are config — tune freely. `canUserDoThis(user, feature)` is the gate.
- **Checkout + Manage billing** (`src/lib/billing-actions.ts`): server actions
  (so they ride `/` → :3000, no nginx fight). Upgrade → Stripe Checkout; Pro users
  get a "Manage billing" button → Stripe Customer Portal.
- **Webhook** (`src/app/api/stripe/webhook/route.ts`): verifies the Stripe
  signature, then on `customer.subscription.*` sets `user.plan`, status, and
  renewal date. Has its **own auth-free nginx location** (Stripe can't send the
  site password; the signature is its auth).
- **Schema:** `user` gains `stripe_customer_id`, `stripe_subscription_id`,
  `subscription_status`, `current_period_end`; new `usage_ledger` table.
  Migration `0003_stage2_billing.sql` (additive — no drops).
- **UI:** a Billing section on `/profile` (Upgrade / Manage, renewal date).

---

## One-time Stripe dashboard setup (TEST mode)

Do all of this with the **Test mode** toggle ON (so it's fake money + test cards).

1. **Create the Pro product → get the Price ID**
   - Product catalog → **Add product** → name `Static Cling Pro`.
   - Pricing: **Recurring**, **$8.00 / month**, USD → Save.
   - Copy the **Price ID** — it looks like `price_1abc...`. → this is `STRIPE_PRICE_ID`.
2. **Secret key** → `STRIPE_SECRET_KEY` (your `sk_test_…`; Developers → API keys).
3. **Create the webhook → get its signing secret**
   - Developers → **Webhooks** → **Add endpoint**.
   - Endpoint URL: `https://static-cling.com/api/stripe/webhook`
   - Events to send: `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`
     (or just "Select all events" — we ignore the rest).
   - Save → reveal the **Signing secret** `whsec_…` → this is `STRIPE_WEBHOOK_SECRET`.

---

## Deploy (same flow as Stage 1)

1. FileZilla `static-cling-v4-stage2.tar.gz` → `/root/` on the box.
2. On the box:
   ```
   tar xzf /root/static-cling-v4-stage2.tar.gz -C /opt/static-cling-v4
   chown -R walt:walt /opt/static-cling-v4
   cd /opt/static-cling-v4 && bash deploy/golive.sh
   ```
   golive applies migration `0003`, adds the webhook nginx rule, and now
   **preserves any keys already in `.env`** across re-runs.
3. **Add your three Stripe values** to the box `.env`:
   ```
   nano /opt/static-cling-v4/.env
   ```
   Fill in the lines golive wrote:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_ID=price_...
   ```
   Save, then: `systemctl restart static-cling-v4`

> `golive.sh` now keeps these across future re-runs, so you only paste them once.

---

## Test the whole loop

1. https://static-cling.com/profile → **Upgrade to Pro — $8/mo**.
2. On Stripe Checkout, pay with the test card **`4242 4242 4242 4242`**, any
   future expiry, any CVC, any ZIP.
3. You're sent back to `/profile?upgraded=1`. Within a second or two the webhook
   flips you to **Pro** (refresh if needed) — the Plan row reads Pro and a
   renewal date + "Manage billing" button appear.
4. Click **Manage billing** → the Stripe portal opens; cancel there → the webhook
   flips you back to Free.

If Pro doesn't appear: Stripe Dashboard → Developers → Webhooks → your endpoint →
check recent deliveries for errors (a 400 means the signing secret in `.env`
doesn't match the endpoint's `whsec_`).

---

## Tuning later
- **Price:** change it in the Stripe product, update `STRIPE_PRICE_ID`, and the
  display number `PRO_PRICE_USD` in `src/lib/billing.ts`.
- **Limits / what Pro unlocks:** `PLAN_LIMITS` in `src/lib/billing.ts`.
- **Go live (real money):** swap test keys for `sk_live_…` + a live product price,
  create a live-mode webhook, set `STRIPE_*` to the live values. That's a Stage 7
  launch task.

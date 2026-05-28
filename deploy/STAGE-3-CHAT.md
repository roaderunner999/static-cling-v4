# Stage 3a — Chat (server-side Claude + streaming)

The heart of the legacy app, rebuilt properly: a real chat with the Claude key
**server-side**, SSE streaming, Postgres-persisted threads, the usage ledger
finally getting written, and the free-plan cap enforced. This is the first slice
of Stage 3 ("Port Notes & Chat"). Notes, drag-drop media, and the →TO CHAT
bridge come next (3b / 3c).

## What's in this bundle

- **`/chat`** — the chat UI (sidebar of conversations, model picker, streaming
  replies). Linked from the home page and `/profile`.
- **`/api/chat`** — the streaming route handler. Auth → free-cap gate → persist
  the user turn → stream Claude (`messages.stream()`) → persist the assistant
  turn → write a `usage_ledger` row with computed cost.
- **New tables** (`conversation`, `message`) — migration **`0005_lonely_sheva_callister.sql`**
  (purely additive on 0004; no drops).
- **Models**: Sonnet 4.6 (default), Opus 4.7, Haiku 4.5 — user-selectable in the
  composer. Pricing + cost math live in `src/lib/models.ts`.
- **Usage ledger** is now written on every call (`src/lib/usage.ts`), and the
  **free cap** (50 msgs/mo free, 2000 Pro — `PLAN_LIMITS` in `billing.ts`) is
  enforced before each message.

## What you need to do (one new key)

Chat is **env-gated** like Stripe/Google — it stays dark until the key is set.

1. Deploy (same flow as before — see below).
2. On the box, add your Anthropic key to the env file:
   ```bash
   nano /opt/static-cling-v4/.env       # set: ANTHROPIC_API_KEY=sk-ant-…
   systemctl restart static-cling-v4
   ```
   `golive.sh` **preserves** `ANTHROPIC_API_KEY` across future re-runs (it's in
   the prev/preserve list), so you only paste it once.

Until the key is set, `/chat` loads but shows "Chat isn't configured on this
server yet" and the composer is disabled — honest, not faked.

## Deploy (established flow)

```bash
# from the repo root, build the bundle (excludes node_modules/.next/.git/.env.local)
tar czf static-cling-v4-stage3.tar.gz \
  --exclude=node_modules --exclude=.next --exclude=.git --exclude=.env.local .
# FileZilla static-cling-v4-stage3.tar.gz -> /root/ on the droplet, then:
tar xzf /root/static-cling-v4-stage3.tar.gz -C /opt/static-cling-v4
chown -R walt:walt /opt/static-cling-v4
bash /opt/static-cling-v4/deploy/golive.sh
```

`golive.sh`:
- Applies migration **0005** (`npm run db:migrate`) on top of the box's current
  state — additive, safe.
- Adds a more-specific **`location /api/chat/`** nginx block (auth_basic +
  `proxy_buffering off`, SSE-friendly) so streaming reaches `:3000` instead of
  being shadowed onto the legacy `:8080` backend. Same family of fix as
  `/api/auth/` and `/api/stripe/webhook`.
- Preserves all provider keys (including the new `ANTHROPIC_API_KEY`) and
  auto-reverts nginx if the new config fails `nginx -t`.

## Notes / deliberate choices

- **Default model is Sonnet 4.6** (best speed/intelligence balance). Opus 4.7
  and Haiku 4.5 are one click away in the composer. Change the default in
  `src/lib/models.ts` (`DEFAULT_MODEL`) if you'd rather lead with Opus.
- **Thinking is off** for snappy, cheap chat. Adaptive thinking + an effort
  toggle are a clean future addition (per-model — Haiku 4.5 rejects `effort`).
- **Markdown** renders as preserved-whitespace plain text for now (no markdown
  lib pulled in yet). Rich rendering is polish for a later pass.
- **Prompt caching** is wired (cache_control on the system block + the last
  message). Short chats sit under the cacheable-prefix minimum so it only starts
  paying off as a thread grows — correct and harmless either way.
- **Cost** is computed per call (input/output + cache read/write rates) and
  stored in `usage_ledger.cost_cents`. The Lab and a cost view can read it later.

## Not in this bundle (Stage 3b / 3c)

Tiptap notes editor + persistence, drag-drop media, the →TO CHAT bridge. The
"Alex climbing" easter egg from V3 is intentionally **not** ported (Walter wants
that done differently with better graphics later).

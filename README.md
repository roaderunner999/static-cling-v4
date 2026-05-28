# Static Cling v4

The ground-up rebuild of static-cling.com — **Chat, Notes, Tasks, and a Dashboard**
as faces of one AI workspace. Lyons Software, Merritt Island FL.

Built per the **Rebuild Roadmap** (May 22, 2026). The original static-cling.com
codebase is kept intact in a separate repo as the working spec; this repo does
not edit it.

## Stack

| Layer        | Choice                                      |
| ------------ | ------------------------------------------- |
| Framework    | Next.js 16 (App Router, TypeScript, strict) |
| UI           | React 19 + Tailwind CSS v4 (class-based dark mode) |
| Editor       | Tiptap v3 (rich text, tasks, images, AI actions)   |
| AI           | `@anthropic-ai/sdk` — server-side streaming + Auto routing |
| Database     | PostgreSQL + Drizzle ORM                     |
| Driver       | postgres.js (`prepare: false`, pooler-safe) |
| Auth         | Better Auth (email/password + sessions)     |
| Billing      | Stripe (Checkout + Customer Portal + webhook) |
| Env safety   | zod-validated `env` (fail fast)             |
| CI           | GitHub Actions — typecheck · lint · build   |

Hosting is **DigitalOcean** (not Fly, as originally planned) — see Deployment.

## What's live

- **Chat** — `/chat`, server-side Claude with SSE streaming, web search + vision
  (drag-drop images), per-message **Auto routing** (Haiku classifies → routes to
  the cheapest capable model, with a transparency badge), markdown rendering, and
  a collapsible conversation sidebar.
- **Notes** — `/notes`, a Tiptap rich editor with inline **AI word-processing**
  (improve / fix / shorten / lengthen / summarize / continue), image embedding, a
  **→ Send to chat** bridge, and a distraction-free **Zen mode** (edge-to-edge
  blank canvas, fading corner menu, draggable formatting widget; remembers itself
  across reloads).
- **Tasks** — `/tasks`, grid + kanban board, priorities/goals/status, Postgres-backed
  (syncs across devices), with legacy import/export.
- **Dashboard** — the logged-in `/` command center (counts, up-next tasks, recent
  notes & chats) with a calm first-timer welcome for brand-new accounts.
- **Profile / billing** — `/profile`, Stripe Checkout + Customer Portal, Pro $8/mo.
- **Admin** — owner-only `/admin` (user management, security log) and `/lab`
  (org-wide Claude spend, Auto-routing distribution, cost-by-model/feature, a
  model×prompt **benchmark**, and a paginated activity log).
- **Auth** — Better Auth email/password + sessions; Google OAuth & magic-link are
  env-gated drop-ins.
- **Theme** — light/dark toggle with a no-flash boot script.

## Getting started

```bash
cp .env.example .env.local   # then set DATABASE_URL
npm install
npm run dev                  # http://localhost:3000
```

> Note: there is no local Postgres in this dev setup — the only database is on the
> droplet. Locally you can write code, typecheck, lint, `next build`, and run
> `drizzle-kit generate` (offline); signup/login and the AI features need the box.

## Scripts

| Script                | Does                                              |
| --------------------- | ------------------------------------------------- |
| `npm run dev`         | Dev server                                        |
| `npm run build`       | Production build                                  |
| `npm run typecheck`   | `tsc --noEmit`                                     |
| `npm run lint`        | ESLint                                            |
| `npm run db:generate` | Generate SQL migration from `src/db/schema.ts`    |
| `npm run db:migrate`  | Apply migrations (needs a live `DATABASE_URL`)    |
| `npm run db:push`     | Push schema directly (dev convenience)            |
| `npm run db:studio`   | Drizzle Studio                                    |

## Layout

```
src/
  app/            App Router routes: /, /chat, /notes, /tasks, /profile,
                  /admin, /lab, /login, /signup, api/{chat,auth,stripe}
  components/     chat-ui, notes-ui, note-editor, tasks-ui, dashboard,
                  site-header, theme-toggle, markdown, benchmark,
                  paginated-table, admin-console, …
  db/
    index.ts      Drizzle client (postgres.js)
    schema.ts     user/session/account/verification, usage_ledger,
                  conversation/message, note, task
  lib/            auth, session, billing, admin, models, anthropic, usage,
                  chat-{queries,actions}, note-{queries,actions},
                  task-{queries,actions}, auto-route, lab-queries, benchmark
  env.ts          zod-validated environment variables (+ feature flags)
drizzle/          Generated migrations (committed, 0000–0008)
drizzle.config.ts drizzle-kit config
```

## Deployment

Live at **https://static-cling.com/** — public (the old site-wide HTTP basic auth
has been removed; Better Auth guards Chat/Notes/Tasks/Profile, and `/admin` + `/lab`
are admin-gated). Runs on a DigitalOcean droplet (Ubuntu 24.04), not Fly:

- **nginx** (`:80`/`:443`, Let's Encrypt TLS) reverse-proxies `/` to the Node app
  on `127.0.0.1:3000`. `:3000` is never exposed publicly. Specific `/api/*` routes
  (`/api/auth/`, `= /api/chat`, `= /api/stripe/webhook`) get longest-prefix nginx
  blocks so they beat the legacy `:8080` `/api/` proxy.
- **systemd** unit `static-cling-v4.service` runs `next start`. App at
  `/opt/static-cling-v4`; runtime env at `/opt/static-cling-v4/.env`.
- Dedicated PostgreSQL database `staticcling_v4` (local to the droplet).

Reproducible scripts live in `deploy/`:

| Script              | Does                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `deploy/setup.sh`   | Provision a droplet: Node, PostgreSQL, build, systemd on `:3000`.    |
| `deploy/golive.sh`  | Build + restart + cut nginx over to v4. Backs up nginx config, gated on a health check, auto-reverts if `nginx -t` fails. Preserves all secrets across re-runs and applies pending migrations. |

Update flow: build a tarball (exclude `node_modules`/`.next`/`.git`/`.env.local`)
→ upload to the box → `tar xzf … -C /opt/static-cling-v4 && chown -R walt:walt …`
→ `bash deploy/golive.sh`. Per-stage handoff notes live alongside as
`deploy/STAGE-1-AUTH.md`, `STAGE-2-BILLING.md`, `ADMIN-CONSOLE.md`, `STAGE-3-CHAT.md`.

## Roadmap status

- [x] **Stage 0 — Foundation** ✅ live (2026-05-24): Next.js 16 + TS strict,
      Tailwind, Drizzle + first migration on live Postgres, zod env, DO + nginx/TLS.
- [x] **Stage 1 — Auth (Better Auth)** ✅ live (2026-05-26): email/password +
      sessions, `/signup` `/login` `/profile`, `proxy.ts` guard.
- [x] **Stage 2 — Billing (Stripe)** ✅ live (2026-05-26): Checkout + Portal +
      signature-verified webhook → plan state, Pro $8/mo, `usage_ledger`, plan gates.
- [x] **Admin console** ✅ live (2026-05-27): owner-only `/admin` (`role` column +
      `ADMIN_EMAILS` allowlist), user management, recent-logins security log.
- [x] **Stage 3a — Chat** ✅ live (2026-05-27): SSE streaming, server-held
      `ANTHROPIC_API_KEY`, `conversation`/`message`, per-call ledger, free cap
      (50/mo free · 2000 Pro), model picker, web search, vision, **Auto routing**.
- [x] **Stage 3b — Notes** ✅ live (2026-05-27): Tiptap editor + persistence,
      inline **AI actions**, plus **Zen mode** (latest batch).
- [x] **Stage 3c — Media + → Chat bridge** ✅: image embed (chat + notes),
      selection-aware Send-to-chat.
- [x] **Tasks** ✅ live (2026-05-27): grid + board, Postgres-backed, import/export.
- [x] **The Lab** ✅ (admin): spend, Auto-routing distribution, cost tables,
      benchmark, paginated activity log.
- [x] **Dashboard** ✅: logged-in command center + first-timer welcome.
- [ ] Stage 4–8 — scheduled widgets (Inngest), custom buttons + routing thresholds,
      PRO file-storage/manager (parked idea), polish/launch, Tauri desktop shell.

## Build log

The app shows its build version in the header (`src/lib/version.ts`). Current: **4.1.4**.

- **4.1.0** — Collapsible sidebars (default collapsed, remembered), edge-to-edge
  chat composer + hidden scrollbar, half-size theme toggle, **Notes Zen mode**
  (blank canvas, fading corner menu, draggable formatting widget), Lab pagination
  (50/page), first-timer dashboard, selection-aware Send-to-chat, images ride to
  chat, **AI-glow** pulse on inline AI actions, resume last chat/note on open,
  dashboard links open the specific note/chat, Server-Action body limit → 24 MB,
  note-image downscaling on paste.
- **4.1.1 – 4.1.2** — Diagnostic instrumentation while chasing a note-image bug.
- **4.1.3** — **Fix:** the Tiptap doc was losing ~half its content (incl. embedded
  images) when passed as an object through a Next Server Action; now passed as a
  JSON string (verbatim across the boundary). Images persist in notes again.
- **4.1.4** — Removed the diagnostic logging; kept the fix + a visible "Save failed"
  status. **(current build)**

## GitHub status

`origin` = `roaderunner999/static-cling-v4` (branch `main`). The repo on GitHub is
at commit **`e5fbc02`** (Stages 1–2 + admin). Everything since — all of Stage 3
(chat, notes, tasks, lab, auto-routing) plus the 4.1.x UI/Zen/fix work — is
committed locally (**11 commits ahead**) and pending upload to GitHub. The live
site on the droplet is updated independently via FileZilla → `golive.sh`, so it is
already running build 4.1.4; GitHub is just the code backup and is catching up.

See `static_cling_rebuild_roadmap_PROGRESS_*.html` for the full illustrated roadmap.

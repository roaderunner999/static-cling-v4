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
  the cheapest capable model, with a transparency badge), markdown rendering, a
  collapsible conversation sidebar, and a **search box that searches inside your
  conversations** (message bodies, not just titles, with highlighted snippets).
- **Rooms** — `/rooms`, self-hosted multi-user group chat (SSE + Postgres, **no
  per-minute cost**) with two AI participants, **Claude** & **Claudette**, who reply
  like real people. They have **real web access** (a `🌐 searched the web` strip
  shows only when they actually did), **see images you drop** (vision ID), and you
  can **drag-and-drop files** (image thumbnails → lightbox; PDFs/any file → download).
- **Renegades** — `/renegades`, live **video + voice + chat** rooms (LiveKit) for
  when you want faces; a click drops you straight into the lobby with chat open.
- **Notes** — `/notes`, a Tiptap rich editor with inline **AI word-processing**
  (improve / fix / shorten / lengthen / summarize / continue), image embedding, a
  **→ Send to chat** bridge, a search box that **searches inside note bodies**, and a
  distraction-free **Zen mode** (edge-to-edge blank canvas, fading corner menu,
  draggable formatting widget; remembers itself across reloads).
- **Tasks** — `/tasks`, grid + kanban board, priorities/goals/status, Postgres-backed.
  Grid rows expand into a details panel (editable notes + checklist); multiple open at once
  (syncs across devices), with legacy import/export.
- **Agents** — `/agents`, saved repeatable Claude tasks that return a *structured*
  result rendered as a card on a rearrangeable board (number / list / table / trend
  sparkline / text / image), pulling from the web, Claude's knowledge, or **your own
  tasks & notes**. (Scheduling is the next stage.)
- **Dashboard** — the logged-in `/` command center (counts, up-next tasks, recent
  notes & chats) with a calm first-timer welcome for brand-new accounts.
- **Navigation** — a thin desktop **left icon rail** (label shows as a small hover
  box by default, or under each icon — switchable in Settings → Appearance); on
  phones a compact top dropdown nav takes over. Renegades sits up in the top bar.
- **Settings** — `/settings`, a full account area: profile, **own usage**
  (precise spend + per-model breakdown + a messages-vs-limit meter), plan & billing,
  **preferences** (default chat model + default landing view), **security** (active
  sessions + sign-out-other-devices), an **Appearance** card (theme + an opt-in
  header theme toggle), and a delete-account flow.
- **Profile / billing** — `/profile`, Stripe Checkout + Customer Portal, Pro $8/mo.
- **Admin** — owner-only `/admin` (user management, security log, **per-user spend
  breakdown** with a month/all-time toggle) and `/lab` (org-wide Claude spend,
  Auto-routing distribution, cost-by-model/feature, a model×prompt **benchmark**,
  and a paginated activity log).
- **Real spend** — Claude cost is tracked at **micro-dollar precision** (sub-cent
  calls no longer round to $0), and the admin console reconciles our estimate against
  Anthropic's **actual billed spend** via the Usage & Cost Admin API (env-gated on an
  `sk-ant-admin…` key; honest "estimate only" state until set).
- **Auth** — Better Auth email/password + sessions; Google OAuth & magic-link are
  env-gated drop-ins.
- **Top bar** — a compact user-menu dropdown (Settings / Profile / Sign out) and a
  rock-solid layout (reserved scrollbar gutter, so the menu never shifts on navigation).
- **Theme** — light/dark, set in Settings → Appearance, with a no-flash boot script.

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
  app/            App Router routes: /, /chat, /rooms, /renegades, /notes,
                  /tasks, /agents, /settings, /profile, /admin, /lab, /login,
                  /signup, api/{chat,auth,stripe,rooms,renegades,tts,admin}
  components/     chat-ui, rooms-ui, renegades-ui, notes-ui, note-editor,
                  tasks-ui, agents-ui, dashboard, side-rail, sidebar-search,
                  site-header, user-menu, markdown, benchmark, admin-console, …
  db/
    index.ts      Drizzle client (postgres.js)
    schema.ts     user/session/account/verification, usage_ledger,
                  conversation/message, note, task, agent, room_message
  lib/            auth, session, billing, admin, models, anthropic, usage,
                  anthropic-admin (real org spend), chat-{queries,actions},
                  note-{queries,actions}, task-{queries,actions}, auto-route,
                  rooms / room-bus / room-ai, search-util, rail-prefs,
                  lab-queries, benchmark, settings-{queries,actions}, version
  env.ts          zod-validated environment variables (+ feature flags)
drizzle/          Generated migrations (committed, 0000–0012)
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
- [x] **Settings + real spend** ✅ (2026-05-28): `/settings` account area; usage
      ledger upgraded to **micro-dollar precision** (migration `0009`); admin
      **per-user spend breakdown**; **Anthropic Cost API** reconciliation (real billed
      spend vs our estimate, env-gated on `ANTHROPIC_ADMIN_KEY`).
- [x] **Stage 4 — the agent primitive** ✅ live (2026-05-28): `/agents` board, the
      `{render_target, data_source, schedule, budget_cents}` contract + renderers, agents
      over your own tasks/notes (migration `0010`). *(The AUTO router half of Stage 6 is
      also done.)*
- [x] **Rooms** ✅ live: self-hosted Claude + Claudette group chat (SSE + Postgres), with
      web access, image vision, file-drop, and a web-search transparency strip
      (migrations `0011`, `0012`).
- [x] **Renegades** ✅ live: LiveKit video/voice/chat rooms; auto-join lobby + chat-open.
- [ ] **Stage 5–6 — finish the agent system**: **scheduled agents** via Inngest (e.g. the
      real-estate-broker morning-listings agent, or an agent that watches a verified
      source and pings you), plus **custom user-tweakable agents** defined in plain English.
- [ ] **VIP tier** (idea): bring-your-own Anthropic key (BYOK) so power users run on
      their own credits and see precise usage; a per-VIP workspace gives real,
      Anthropic-sourced per-user attribution.
- [ ] **Stage 7–8** — polish/security/observability/launch (rate limits ✅, still need
      Sentry/logging/backups/status page/live-mode Stripe), Tauri desktop shell.

## Dream roadmap (the north stars)

The features that make Static Cling *known* — bigger than a stage, captured here so the
vision stays in view while the core gets solid:

- **🏛️ Intranet Claude — teach Claude on your own knowledge.** A private, on-server
  knowledge layer so a person or business has a Claude that knows *their* world: a
  **Claude Safe** (the small, trusted vault of critical references Claude can always
  reach) and a **Claude Cabinet** (a company's working files Claude collaborates over —
  "100 workers' past knowledge," instantly). You'd have **both** — the web Claude *and*
  the intranet Claude — switchable. Needs server storage + a retrieval (RAG) layer wired
  as a new agent/chat *data source*. The differentiator a business pays for.
- **🤖 Proactive agents.** Agents that run on a schedule or **watch a verified source**
  and reach out *first* — the "I found the exact car you wanted on Craigslist, but it's an
  automatic — still interested?" moment. (Builds on the live agent primitive + the new
  web/vision in Rooms.)
- **🔔 Universal notifications.** A thin top-row indicator: a person posted in a group
  chat, a phone message is waiting, or **Claude is watching a running job and spotted
  something off** and tells you to stop — with Claude-authored summaries. The freed
  top-bar space (now just your initials) is reserved for exactly this.
- **🎙️ Always-on voice.** A constant-listening mode that trims the "umm…"s, hears the
  *intent* ("ok, Walt's asking for his next appointment"), and answers back — a real
  phone-call feel. A fast listener-Claude + a deep responder, with speculative
  answer-prefetch during your pauses.
- **☎️ Sim calls.** Simulated calls where no one's quite sure who's human and who's AI —
  the AI does live lookups mid-conversation, gently steers, and co-builds the to-do toward
  your goals.
- **🎬 Integrations.** Runway AI ↔ Claude, and a "Claude-Code-but-better" capability
  woven into the workspace.
- **💬 The universal chat surface.** One fluid, presence-aware page where 1:1 Claude,
  group rooms, and agents converge — invite people into an in-progress AI chat, run
  several at once, each glowing when there's something new.

## Build log

The app shows its build version in the header (`src/lib/version.ts`). Current: **4.6.14**.

- **4.6.14** — **Claudette can lead + the web-search proof strip.** (1) A **super-thin
  transparency strip** appears under a room-AI reply — `🌐 searched the web · Haiku 4.5`
  — **only when the model actually hit the web** (server-confirmed via the response's
  `web_search_tool_result` blocks, so it can't be faked). (2) Fixed Claude "taking the
  reins" — when you address **Claudette** by name she now **answers the turn herself**
  (Claude stays out) and is empowered to search the web / read images on her own instead
  of deferring to Claude.
- **4.6.11 – 4.6.12** — **Rooms get hands and eyes.** Drag-and-drop **file sharing**
  (images + PDFs/any file): a whole-area drop zone + 📎 button, client-side image
  downscaling, **clickable thumbnails → lightbox**, file chips → download. Stored as an
  `attachments` column (**migration `0012`**). Claude & Claudette get **real web access**
  (the same `web_search` tool `/chat` has) and **image vision** — they actually *see*
  dropped images and can identify them (the "what's this car?" → "'70 Chevy Nova" moment),
  then search the web about it.
- **4.6.8 – 4.6.10** — **Rooms + nav polish.** New-room creation fixed (slugify + the
  room sticks as a pill); username trimmed to **initials**; **Renegades** moved to the top
  bar; pages standardized **full-width with consistent headers**; Lab's recent-activity log
  **loads on click**; the left rail's label style became a **Settings choice** (hover box
  default); and `/renegades` now **auto-joins the lobby with chat open** behind a calm
  "Joining…" loader.
- **4.6.6 – 4.6.7** — **Search.** A search box at the top of the Chat & Notes slide-out
  lists — and it searches **inside** message and note *bodies* (server-side, owner-scoped,
  with the matching snippet highlighted), not just titles. Plus a thinner left icon rail.
- **4.6.5** — **Lab/Admin/Chat fixes.** Killed the duplicate "Sonnet 4.6" rows (a real
  `labelForModel` that names voice/old-rev models instead of collapsing them to the
  default); admin's slow external **spend cards now load on click** instead of blocking the
  page; the chat **mic stops cleanly on send** (no more stuck-glowing mic on phones);
  **donut charts** next to the Lab's cost tables.

- **4.6.4** — **Phone header: bolt logo + icon-only nav.** On phones the
  "Static Cling v4" wordmark was eating width and shoving the avatar off-screen.
  Now `<sm` shows a compact **violet ⚡ lightning mark** in the corner (wordmark
  returns at `sm`+), and the dropdown buttons go **icon-only** below `sm` (labels
  return at `sm`+). Result: bolt + theme + 3 dropdowns + avatar all fit a 375px
  iPhone 13 mini with room to spare.

- **4.6.3** — **Claude-style shell: left rail + dashboard home.** (1) New
  collapsed **left icon rail** (`side-rail.tsx`, desktop/`md+` only) — Home · Chat
  · Rooms · Renegades · Notes · Tasks · Agents; hovering "auto-pulls" the labeled
  apps menu open as an overlay (the 56px gutter stays reserved). On mobile it
  hides and the top dropdown nav takes over. (2) The signed-in **home is a
  dashboard again** (not the centered chat launcher) — "Back at it, {name}", a
  **slim ask + 🎤 voice bar** (`dashboard-ask.tsx`, uses the dictation hook) so
  chat is one tap away without dominating, then glance cards (tasks/notes/chats/
  usage) and the Agents banner. (3) **Voice-blocked notice** in rooms — if the
  browser mutes the Web Speech API (Brave fingerprint protection returns zero
  voices), the Listen toggle now surfaces a clear banner instead of failing
  silently. Next: server-voice option for read-aloud + the login redesign.

- **4.6.2** — **Mobile/header fixes + room audio unlock.** (1) **Room read-aloud
  now actually plays** — speech was being dropped because it wasn't kicked off by
  a user gesture; the Listen toggle now primes the engine inside the click (with
  an audible "Voice on" cue) and calls `resume()` before each read, so
  network-triggered turns aren't silently swallowed (esp. in Brave). (2) **Nav
  dropdowns no longer fly off-screen** on a 375px phone — on mobile they pin to
  the screen's right edge (fixed, viewport-capped width); sm+ still drops under
  the button. (3) **Logo stays on one line** — `whitespace-nowrap` + tighter
  mobile tracking + the build tag hidden on mobile, so the brand no longer wraps
  to "STATIC / CLING / V4" and triple the header height. (4) **Header condensed**
  to ElevenLabs scale (py-1.5, tighter gaps). Next: the optional left icon rail.

- **4.6.1** — **Centered "start chatting" home + cooler nav.** (1) The signed-in
  home is now a calm, centered launcher (`home-launcher.tsx`) — "✦ Back at it,
  {name}", a glowing composer (Enter to send), and starter pills (Write / Learn /
  Code / Brainstorm) that seed the box; submitting stashes the prefill and opens
  `/chat?new=1`. Replaces the dense Dashboard as the landing (Dashboard component
  kept for the future unread/activity view). (2) Signed-out landing decluttered —
  dropped the bottom feature grid so the eye lands on the centered hero. (3) Nav
  buttons restyled: icon + label rounded pills with a soft violet hover-glow
  (matching the AI glow), a flipping chevron, press-scale, and a spring "pop" on
  the menu (`.nav-pop` keyframe). Still 3 dropdowns + user menu (iPhone-13-mini
  fit preserved). Next: an optional left icon rail as an alternate nav.

- **4.6.0** — **Rooms get voices; nav fits a phone.** Three things: (1) **Hear it**
  — a Listen toggle in a room reads Claude & Claudette aloud using **native
  browser TTS** (free, no limit, ~no delay), with two distinct voices (different
  voice + pitch/rate) so the AIs sound like two people. Live turns only (never
  the backfill); toggling off cancels speech. (2) **Full-width rooms** — dropped
  the centered `max-w-3xl` so the room uses the whole screen. (3) **Trimmed nav
  for iPhone 13 mini** — the six links became **three dropdown buttons + the user
  menu** (4 slots total): **Chat** (Chat · Rooms · Renegades), **Notes** (Notes ·
  Tasks), **Agents** (Agents). New `components/main-nav.tsx` (one menu open at a
  time, outside-click/Escape to close, active route highlighted violet); the
  user menu still holds Settings/Profile/Lab/Admin. Premium room voices
  (Cartesia/ElevenLabs from the bake-off) can layer on later; native is the
  free-forever default.

- **4.5.9** — **Rooms — self-hosted AI group chat (Claude + Claudette).** A new
  **Rooms** nav item opens `/rooms`: multi-room group chat (general / porsche /
  random + any typed slug) with live presence, built on **SSE + Postgres** —
  zero external realtime service, **no per-minute cost** (the answer to LiveKit
  Cloud credits; LiveKit `/renegades` stays for live video). Realtime is an
  in-process bus (`lib/room-bus.ts`) fanning out to `EventSource` clients;
  history persists in a new `room_message` table (migration 0011). The headline:
  two AI participants — **Claude** (violet, level/factual) and **Claudette**
  (rose, warm/witty) — reply to *human* turns on cheap Haiku 4.5, short and
  conversational. Loop guard: AIs only respond to human messages (never each
  other), and run via `after()` post-response so the human turn broadcasts
  instantly. Claudette chimes in when named/asked. Reuses the existing Anthropic
  key (no new env); `/api/rooms/` got an SSE-safe nginx carve-out in golive.sh.
  This is the foundation the VIP `renegades` app will build on (image-drop ID +
  read-aloud listen-mode next).

- **4.5.8** — **Renegades room crash fixed ("No room provided").** With nginx
  fixed, the token call returned 200 — but joining a room crashed the page. The
  in-room top bar (`RoomBar` → live "N here" count + Copy-invite) calls LiveKit
  hooks (`useParticipants`/`useRoomContext`) that require the Room context, but
  it was rendered *outside* `<LiveKitRoom>`. Moved `RoomBar` inside the
  `<LiveKitRoom>` provider (which now owns the flex-column layout). Lesson for
  this app: any `@livekit/components-react` hook must live inside `<LiveKitRoom>`.

- **4.5.7** — **nginx routing fix: new API routes were 404ing in production.**
  `/api/renegades/token` (and `/api/tts/bench`) returned 404 live while working
  locally. Root cause: the droplet's nginx proxies `location /api/` to a *second
  backend on :8080*, and only a hand-picked list of routes is explicitly carved
  out to the Next app on :3000. New Next API routes fall through to :8080 and
  404. Fix in `golive.sh`: (1) broadened `location = /api/tts` → prefix
  `location /api/tts` so it covers `/api/tts/bench` too; (2) added a
  `location /api/renegades/` → :3000 block. **Any future Next API route under a
  new path needs its own carve-out here** until the `/api/ → :8080` backend is
  retired. No app-code change. (Live sites can hot-patch nginx without a rebuild
  — see deploy notes.)

- **4.5.6** — **Renegades — the social leap (phase 1).** Static Cling goes from a
  personal tool to a *place*: a new violet **Renegades** nav item opens
  `/renegades`, a LiveKit-powered hangout. A lobby lets you create or join a
  named room (suggested rooms + free-text); joining mints a scoped, expiring
  LiveKit token server-side (`/api/renegades/token`) and drops you into a full
  room — **presence (live "N here" count), text chat, mic, and camera** via
  LiveKit's prebuilt VideoConference. Deliberate defaults: you join **muted +
  camera-off** (we never blast a webcam on entry), and a room with an unguessable
  name *is* a private room — "Copy invite" shares a `?room=` deep-link so a
  friend lands straight in ("meet me in our chat"). Drop-in env (`LIVEKIT_URL` +
  key/secret) wired into `golive.sh`; page shows an honest setup panel until a
  free cloud.livekit.io project is connected. Deps added: `livekit-server-sdk`,
  `livekit-client`, `@livekit/components-react`+`-styles`.
  **Next phase:** global "who's online across the app" on the dashboard, a
  friends list, and a Claude agent that can join a room as a participant.

- **4.5.5** — **Voice bake-off in /lab — solving the lag.** Walter keeps falling
  back to the free native voice because even ElevenLabs lags. New admin-only
  `/lab → Voice bake-off` panel plays one line through **Native, Cartesia Sonic,
  ElevenLabs Flash, ElevenLabs Turbo, and Deepgram Aura-2** and ranks them by
  time-to-first-audio (green <150ms / amber <350ms / red 350ms+), showing both
  the *felt* TTFA (round-trip to first audio) and the provider's pure *upstream*
  first-byte. Backed by a new admin-gated `/api/tts/bench` route (400-char cap so
  tests stay cheap) and drop-in env keys (`CARTESIA_*`, `DEEPGRAM_*`) wired into
  `golive.sh` so they're preserved across deploys. 2026 research says **Cartesia
  ~90ms** is the latency leader (+ custom voices) — the candidate fast tier;
  ElevenLabs stays the richest. ElevenLabs cards work immediately (key already
  set); paste a Cartesia/Deepgram key to light up those cards. No production chat
  voice changes — `/api/tts` is untouched.

- **4.5.4** — **Chat & Notes are usable on a phone.** Both pages were a fixed
  256px sidebar sitting beside the main pane in one horizontal row with no
  breakpoints — on an iPhone 13 mini (375px) the detail pane (note editor / chat
  thread) got crushed off the right edge, and the chat input row jammed the model
  picker + 📎 + 🎤 + voice + Turbo + textarea + Send into one non-wrapping line
  that shoved the textarea/Send off-screen. Fixed with responsive CSS (no
  user-agent/Safari sniffing): the sidebar is now `w-full md:w-64` and the main
  pane is `hidden md:flex` while the list is open, so a phone shows the list OR
  the detail full-screen (tap a note/chat to reveal it; the `»` button goes
  back), while md+ keeps the side-by-side desktop layout pixel-identical. The
  chat input controls now wrap to their own row below the textarea on mobile
  (`flex-col sm:flex-row`), and the textarea got `min-w-0` so it can shrink.

- **4.5.3** — **"Start a new chat" actually starts a new one.** The dashboard
  button went to `/chat`, which resumes your last conversation on mount — so it
  reopened the existing chat instead of a blank one. Now it links to `/chat?new=1`,
  which skips the resume and opens a fresh composer (an explicit `?id=` still
  wins). The `+ New chat` sidebar button was unaffected.

- **4.5.2** — **Dashboard goes edge-to-edge.** The signed-in home dashboard was
  capped at `max-w-5xl` and centered, looking inset next to the full-width header
  and the Tasks/Notes pages. Switched to `w-full px-4 sm:px-6` to match the
  standard content width everywhere else.

- **4.5.1** — **Voice stop/replay fixes.** A long premium reply couldn't be stopped
  once started ("have to wait it out or refresh") and trying restarted it. Two
  causes: (1) a **play/pause race** — clicking ⏹ while the audio was still
  buffering nulled the ref but `play()` still won and started orphaned audio with
  nothing left to pause it; now a post-`play()` generation check re-pauses if a
  stop landed during buffering, and an interrupted `play()` bails quietly. (2) A
  **single global `speaking` flag** meant every reply's button showed ⏹ and a
  click could replay the wrong one; replaced with a per-message `speakingId` so
  each reply's play/⏹ button is independent. Auto-spoken replies now carry their
  message id too, so their own ⏹ stops them.

- **4.5.0** — **Premium voice: tiered, miser-by-default, no more credit bleed.**
  Four fixes to the ElevenLabs path after a credit scare (3,832 credits gone in
  one light evening on a 40k/mo Starter plan):
  1. **Real errors surface.** A failed `/api/tts` no longer silently falls back to
     native (which on Brave/Linux is silent) and then shows the nonsensical "switch
     to Premium" message *while already on Premium*. The actual ElevenLabs reason
     now shows in the chat banner — that's how we caught the `voice_not_found` that
     started it all (`.env` had a dead `ELEVENLABS_VOICE_ID`).
  2. **Playback race fixed.** Clicking replies to replay no longer overlaps or plays
     two recordings / the wrong one — a generation token + `AbortController` cancel
     in-flight TTS so only the latest request plays (this also double-charged before).
  3. **Tiered access.** New `premiumVoice` entitlement: **free users get native
     browser voice only (zero ElevenLabs cost)**; ElevenLabs is a Pro/VIP upsell,
     enforced server-side in `/api/tts` (403 for free), not just hidden in the UI.
  4. **Model choice + per-model cost.** Premium users pick **Turbo** (snappy, ~half
     the credits — the new default) or **v3** (richest, ~2×) from a picker by the ✨
     toggle; the route allow-lists the model and logs it, so `/lab` and `/admin`
     price each one. `golive.sh` now backs up `.env` before rewriting it.

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
  status.
- **4.2.0** — **Real spend + Settings.** Usage ledger upgraded to **micro-dollar
  precision** (+ cache-token columns, migration `0009` with backfill) so cheap calls
  stop rounding to $0. New **`/settings`** account area (profile, own usage + per-model,
  plan & billing, preferences, security, delete account). Admin **per-user spend
  breakdown** + month/all-time toggle. New **Anthropic Cost API** integration
  (`anthropic-admin.ts`, env-gated `ANTHROPIC_ADMIN_KEY`) — admin reconciles real
  billed spend vs our estimate. Preferences wire a **default chat model** + **default
  landing view**.
- **4.2.1** — **Fix:** `/settings` & `/admin` 500'd — a raw JS `Date` interpolated into
  a `sql` template breaks postgres-js. Switched the month-spend query to drizzle's
  `gte()` operator.
- **4.2.2** — Top bar consolidated into a **user-menu dropdown** (Settings / Profile /
  Sign out); `/settings` & `/profile` made edge-to-edge full width.
- **4.2.3** — Light/dark toggle **moved into Settings → Appearance**, with an **opt-in**
  (off by default) "show the toggle in the top bar" switch.
- **4.2.4** — **Rock-solid menu:** `scrollbar-gutter: stable` always reserves the
  scrollbar space, so the header no longer shifts when navigating between scrolling
  (Tasks/Settings) and fixed-height (Chat/Notes) pages.
- **4.2.5** — **No Notes resume flash:** reopening `/notes` was briefly showing the
  "create a note" empty state during the async last-note load; now holds a blank canvas
  until the note resolves, so it appears in place with no intermediate flash.
- **4.2.6** — **Expandable task rows.** Each task in the grid now has a disclosure
  chevron — click it to drop the row open into a details panel with an editable
  **Notes** field and a working **checklist** (add / rename / check off / remove
  sub-tasks). Both fields already existed in the data model but had no UI; this
  surfaces them. **Multiple rows can be open at once**, plus **Expand all / Collapse
  all** in the toolbar. Open rows get a subtle violet accent; collapsed rows show a
  `✓ done/total` checklist badge and a one-line notes preview.
- **4.2.7** — **Trimmed the Tasks header.** The big "STATIC CLING / Tasks" title block
  and the four oversized stat cards were eating the whole top of the page. Replaced with
  one slim row — `Tasks` title left, inline `active · done · total · %` stats right — over
  a thin violet **progress bar** (the % complete now lives there). Reduced top padding,
  so the task rows start much higher up. Also: Tasks page made **edge-to-edge** (dropped
  the `max-w-6xl` cap) to match Chat/Notes/Settings.
- **4.3.0** — **Agents (Stage 4 — the agent primitive).** The roadmap's headline
  differentiator lands. An **agent** is a saved, repeatable Claude task that returns a
  *structured* result rendered as a card on a rearrangeable board at **`/agents`**.
  The contract = `{render_target, data_source, schedule, budget_cents}`:
  **render targets** number / list / table / trend (inline SVG sparkline, no chart lib) /
  text / image; **data sources** the live web (Claude + web search), Claude's knowledge,
  or **your own tasks / notes** (the differentiator — agents that work over your data).
  Execution is a server action (`runAgent`, no nginx change): assembles the source → one
  Claude call whose system prompt locks the render target's JSON shape → parses it
  (auto-router style, fail-safe to text) → records spend to `usage_ledger`
  (`meta.feature:"agent"`) → caches the result on the row so cards render instantly.
  Board UI: create/edit slide-over, Run/Refresh, drag-to-reorder, one-click starter
  agents, per-run cost vs budget badge. **Scheduling is inert here** (the `schedule`
  field is stored; the cron executor is Stage 5/Inngest). New table `agent` +
  **migration `0010`** (additive — golive MUST run, not just restart). Linked from the
  top-bar nav and a dashboard tile.
- **4.4.4** — **Consistent page chrome.** `/lab` and `/admin` now render the shared
  **`SiteHeader`** (brand + nav + user menu) and go **full-width** (`w-full px-4 sm:px-8`,
  no more centered `max-w` column) to match `/profile`, `/settings`, `/tasks`, etc.
  Dropped the redundant **"Static Cling" eyebrow** above page titles site-wide (lab,
  admin, profile, settings, agents) — just the title now, since the brand already lives
  in the header. The **Lab / Admin links moved into the user-menu dropdown** (admin-only,
  violet-accented under an "Admin" subhead) and off the Profile page; lab's inline
  Admin/Chat nav and admin's "← Your profile" link removed as redundant.
- **4.4.5** — **Rock-solid header, one universal frame.** New **`AppShell`** component
  (`src/components/app-shell.tsx`) owns the chrome for *every* page: the header now lives
  **outside every scroll container**, so it can't move, blur-shift, or wiggle, and the
  scrollbar **always starts in the same place — directly under the header** — on every
  page. Fixes the old inconsistency where document-scroll pages (`/tasks`, `/agents`,
  `/lab`, `/admin`, `/profile`, `/settings`, home) put the scrollbar at the **top of the
  window** behind a `sticky` header, while inner-scroll pages (`/chat`, `/notes`) put it
  **below** the header. All nine pages now wrap their content in `<AppShell>` (Chat/Notes
  use `scroll={false}` to keep their self-managed full-height panes). `scrollbar-gutter:
  stable` reserves the gutter so content never reflows when the bar appears. Header gets
  `shrink-0` so it can never be squeezed. New pages get all of this for free.

- **4.4.0 – 4.6.4** — **Opus 4.8 + voice + the social layer.** Flagship bumped to **Opus
  4.8**; **voice in/out** (browser dictation + ElevenLabs premium TTS, tiered so free users
  cost nothing); a `/lab` **voice bake-off** (Native / Cartesia / ElevenLabs / Deepgram,
  ranked by latency); **Renegades** live video rooms (LiveKit); self-hosted **Rooms** with
  Claude + Claudette; native room read-aloud; and a nav redesign → dropdowns → the
  **left icon rail + dashboard home** → the phone **⚡ bolt header**.

## GitHub status

`origin` = `roaderunner999/static-cling-v4` (branch `main`). Code is mirrored to GitHub
via the web **"Upload files"** drag-drop. The `github-upload-static-cling-v4/` folder is a
**complete current mirror** (this repo minus `node_modules`/`.next`/`.git`/`.env*`),
refreshed on every build and ready to drag-drop — currently at build **4.6.14**.

Deploy + backup flow each session: build a tarball → FileZilla to the droplet →
`golive.sh` (live), and drag-drop the mirror folder to GitHub (backup). The live site and
the mirror are kept in lockstep at the same build.

See `static_cling_rebuild_roadmap_PROGRESS_*.html` for the full illustrated roadmap.

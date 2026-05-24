# Static Cling v4

The ground-up rebuild of static-cling.com — Notes, Chat, and Dashboard as three
faces of AI. Lyons Software, Merritt Island FL.

Built per the **Rebuild Roadmap** (May 22, 2026). The original static-cling.com
codebase is kept intact in a separate repo as the working spec; this repo does
not edit it.

## Stack

| Layer        | Choice                                      |
| ------------ | ------------------------------------------- |
| Framework    | Next.js 16 (App Router, TypeScript, strict) |
| Styling      | Tailwind CSS v4                              |
| Database     | PostgreSQL + Drizzle ORM                     |
| Driver       | postgres.js (`prepare: false`, pooler-safe) |
| Env safety   | zod-validated `env` (fail fast)             |
| CI           | GitHub Actions — typecheck · lint · build   |

Later stages add Better Auth, Stripe, Inngest, and a Tauri desktop shell.
Hosting is **DigitalOcean** (not Fly, as originally planned) — see Deployment.

## Getting started

```bash
cp .env.example .env.local   # then set DATABASE_URL
npm install
npm run dev                  # http://localhost:3000
```

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
  app/            App Router routes + layout
  db/
    index.ts      Drizzle client (postgres.js)
    schema.ts     Tables (Stage 0: placeholder users)
  env.ts          zod-validated environment variables
drizzle/          Generated migrations (committed)
drizzle.config.ts drizzle-kit config
```

## Deployment

Live at **https://static-cling.com/** (behind HTTP basic auth during development).
Runs on a DigitalOcean droplet (Ubuntu 24.04), not Fly:

- **nginx** (`:80`/`:443`, Let's Encrypt TLS) reverse-proxies `/` to the Node app
  on `127.0.0.1:3000`. `:3000` is never exposed publicly.
- **systemd** unit `static-cling-v4.service` runs `next start`. App at
  `/opt/static-cling-v4`; runtime env at `/opt/static-cling-v4/.env`.
- Dedicated PostgreSQL database `staticcling_v4` (local to the droplet).
- The previous static site (V3.27) is preserved at **/legacy/**.

Reproducible scripts live in `deploy/`:

| Script              | Does                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `deploy/setup.sh`   | Provision a droplet: Node 20, PostgreSQL, build, systemd on `:3000`. |
| `deploy/golive.sh`  | Bring v4 up + cut nginx root over to it (legacy → `/legacy/`). Backs up nginx config, gated on a health check, auto-reverts if `nginx -t` fails. |

## Roadmap status

- [x] **Stage 0 — Foundation prep** ✅ **done + deployed (2026-05-24)**: Next.js 16
      + TS strict, Tailwind, Drizzle + first migration applied on live Postgres,
      zod env validation, deployed to DigitalOcean behind nginx/TLS.
      *(GitHub Actions CI workflow is committed but only runs once the repo is pushed.)*
- [ ] **Stage 1 — Auth & user accounts (Better Auth)** ← next
- [ ] Stage 2 — Subscriptions & billing (Stripe)
- [ ] Stage 3 — Port Notes & Chat
- [ ] Stages 4–8 — Dashboard, scheduled widgets, custom buttons, launch, Tauri

See `static_cling_rebuild_roadmap_PROGRESS_*.html` for the full illustrated roadmap
with progress check-offs and future feature ideas.
</content>

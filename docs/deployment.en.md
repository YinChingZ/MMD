# Deployment Guide

*[中文](deployment.md)*

This document is M5.4's output: how to containerize and deploy `apps/api` (Fastify + Postgres) and `apps/web` (Next.js). The only previously-validated way to run this project was local `npm run dev`/`npm run start` + Homebrew Postgres; this is the first reproducible deployment path.

## Why both Dockerfiles build from the repo root

`apps/api`/`apps/web` import `packages/protocol`, `packages/orchestrator`, etc. by package name — resolved through npm workspaces' hoisted root `node_modules` symlinks (e.g. `node_modules/@mmd/protocol -> ../packages/protocol`). So the build commands must be:

```bash
docker build -f apps/api/Dockerfile .
docker build -f apps/web/Dockerfile .
```

Note the trailing `.` (the build context is the repo root, not `apps/api`/`apps/web`'s own directory), and `-f` is required to point at the Dockerfile.

## A non-obvious, empirically-verified architecture decision: apps/api doesn't run from compiled output

`apps/api/Dockerfile`'s runtime stage ultimately runs `npm run start` (i.e. `tsx src/main.ts`), not the more typical `node dist/main.js`. This wasn't picked casually: each `packages/*` package's `package.json` has `"main"`/`"types"` pointing straight at its own `src/index.ts` (an M5.1-era decision so vitest/tsx never depend on a possibly-stale dist — see `multi-model-deliberation-dev-roadmap.md`). That means the common "just copy dist + node_modules + package.json, run `node dist/main.js`" recipe doesn't work here: the compiled `apps/api/dist/main.js`, on `require("@mmd/protocol")`, follows the symlink to `packages/protocol/src/index.ts` — an uncompiled TypeScript file plain Node.js cannot execute, immediately failing with `ERR_MODULE_NOT_FOUND` (reproduced for real while writing this doc).

The fix is to have the runtime stage take the same path `npm start`/`npm run dev` already do — transpile at runtime via `tsx` (both apps/api's own code and the workspace packages' code) — rather than introducing a bundler or changing how the packages already resolve (changing those `"main"` fields is riskier: it would affect the resolution behavior vitest/tsx already rely on, established over an entire milestone's worth of testing). The trade-off is a runtime image that still carries full dev dependencies (`typescript`, `vitest`, etc.), larger than a pure-production-deps image would be; that's an intentional trade against touching a module resolution scheme this monorepo has already validated extensively.

`apps/api/Dockerfile` still runs the `tsc` build as a type-check gate (fails the image build on a type error), but the runtime stage never touches that output.

## apps/web doesn't have this problem

Every `@mmd/protocol`/`@mmd/orchestrator` reference in `apps/web` is `import type` (type-only, erased at compile time, leaves no runtime trace — the direct result of the M4-era finding that Turbopack can't bundle raw TS workspace source the way tsx/vitest can, which is why this frontend fetches data from apps/api instead of importing orchestrator/protocol runtime values directly). So `next.config.ts`'s `output: "standalone"` output contains no `@mmd/*` at all (verified), and can follow Next.js's standard standalone deployment recipe with no special handling.

## Required environment variables

### apps/api (runtime environment variables — `docker run -e` or your platform's env var panel)

| Variable | Required | Notes |
|------|------|------|
| `DATABASE_URL` | Yes | Postgres connection string, e.g. `postgres://user:pass@host:5432/dbname` |
| `ENCRYPTION_KEY` | Yes | AES-256-GCM key encrypting BYOK users' opted-in saved API keys. Generate with `openssl rand -base64 32`; must decode to exactly 32 bytes |
| `PORT` | No, defaults to `3000` | Listen port |

### apps/web (**`API_BASE_URL` is a build-time argument, not a runtime variable**)

| Variable | Required | Notes |
|------|------|------|
| `API_BASE_URL` | No, defaults to `http://localhost:3000` | apps/api's address. **Resolved exactly once, at `next build` time**, into `.next/routes-manifest.json`'s rewrite destination — Next.js does not re-evaluate `rewrites()` per request. To point at a different API host, rebuild with a different `--build-arg API_BASE_URL=...`; `docker run -e API_BASE_URL=...` has no effect (verified: changing the runtime env var did not change the manifest's destination). |
| `PORT` | No, defaults to `3000` | The standalone `server.js`'s listen port |

## Secret management: no plaintext `.env` in production

`apps/api/.env.example` and the root `.env.example` are for local dev/`docker compose` — `.env`/`.env.local` are already gitignored. In production, use your platform's own secrets management (Railway's Variables panel, Fly.io's `fly secrets set`, Render's Environment panel, etc.) rather than baking `ENCRYPTION_KEY` or DB credentials into a plaintext file in the image or committing them.

Don't rotate `ENCRYPTION_KEY` once it's in use — there's no online key-rotation support (see M4's "known follow-up not in this scope"); rotating requires offline re-encryption of every row in `workspace_api_keys`, or existing saved BYOK keys will fail to decrypt.

## `models.config.json` (optional server-funded model registry)

By default, the containerized `apps/api` runs BYOK-only — no `models.config.json` found means it falls back to `MockProvider` (this matches the project's stance since M4: the operator isn't expected to front model-call costs for anonymous visitors). If you also want to offer a server-funded model registry (M2's original mode), mount the file into the container's apps/api working directory:

```bash
docker run -v $(pwd)/models.config.json:/app/apps/api/models.config.json ...
```

`docker-compose.yml` can add an equivalent `volumes` entry to the `api` service. This file should not be baked into the image itself (rebuilding the image just to change the model list isn't practical) — only mounted/injected at runtime.

## Local verification: `docker compose up --build`

The root `docker-compose.yml` now has `api`/`web` services alongside the existing `postgres` one, each built from its own Dockerfile:

```bash
cp .env.example .env   # fill in ENCRYPTION_KEY (openssl rand -base64 32)
docker compose up --build
```

- `postgres`: port 5432; `api` waits on it via `depends_on` + healthcheck.
- `api`: port 3000; on container start, runs `npm run db:migrate` (idempotent, safe to re-run) then `npm run start`.
- `web`: mapped to host port 3001 (still 3000 inside the container, to avoid colliding with `api`'s host port), built with `args.API_BASE_URL: http://api:3000` (Docker Compose's internal DNS resolves the service name) pointing at the `api` service.

Once it's up, visit `http://localhost:3001` and walk through "create a conversation → add a BYOK key → submit a run → see the result" to confirm containerized behavior matches `npm run dev` — this flow has been run for real against actual Docker containers (not simulated); see "Verification status" below for details.

## Production requires HTTPS: a real, verified gotcha

The anonymous workspace cookie issued by `middleware/workspace.ts` gets the `Secure` attribute whenever `NODE_ENV=production` (which the Dockerfile sets) — this is pre-existing behavior, not something new added here. Running the real Docker containers confirmed it: `docker compose`'s `Set-Cookie` header does carry `Secure`. **That means a real browser will not store/send this cookie back at all if production isn't served over HTTPS** (`curl` won't catch this for you — it doesn't enforce `Secure` semantics by default, so the `curl`-based end-to-end verification below wouldn't have surfaced this; this conclusion is reasoned from the confirmed cookie header, not directly reproduced via a browser hitting plain HTTP). The symptom would be "every request creates a new anonymous workspace, conversation history never sticks around," with no error at all — easy to misdiagnose as something else. Railway/Fly.io/Render's default public domains are HTTPS out of the box, so this usually isn't an issue in practice; it only bites if you're deploying behind a bare HTTP reverse proxy or a self-signed cert setup.

## What happens to a run in flight when the server restarts/redeploys

Every deploy is, at bottom, a restart of the `apps/api` process. A known limitation since M2: if the restart happens while a run is mid-execution (say, waiting on a model call), the background `runDeliberation` promise driving it dies with the process, and that row in `runs` is left at `status = "running"` forever — a reconnecting browser never receives another event and shows "in progress" indefinitely.

As of 2026-07-05, `apps/api/src/services/reconcile-runs.ts` handles this automatically at process startup (after migrations have run, before the server accepts requests): it finds every run still `status = "running"` (which, at startup, can only be left over from a previous process instance — this process hasn't created any runs of its own yet), marks each one `failed` with the message `"Interrupted by a server restart before completion."`, and appends a persisted `run_failed` event so a reconnecting client gets a real terminal state. **This is not resumability** — the interrupted run doesn't pick back up; the user has to submit it again. True cross-restart recoverability is still out of scope for this project's scale and isn't planned.

This doesn't require anything special from the deployment itself (no graceful-shutdown hook needed) — the process just self-heals on the next boot. The only user-facing effect: if a deploy happens to land while someone has a long-running run in flight (standard/planning mode observed at 96-301s), that run gets interrupted and the user has to resubmit it.

## Deploying to Railway (detailed tutorial)

Using [Railway](https://railway.app) as the reference (GitHub integration, automatic Dockerfile detection, one-click Postgres plugin — a good fit for a solo developer); Fly.io/Render follow similar core steps (build the image → set env vars → connect a managed Postgres). The steps below have been run for real against a live Railway account (2026-07-05): all three services (Postgres, `api`, `web`) deployed successfully, `web`'s public domain is reachable, and the `web → api` internal proxy (`GET /api/conversations`) returns correct JSON with the workspace cookie carrying `Secure`/`HttpOnly` as expected. The gotchas hit along the way — especially the "`api`'s PORT has to be pinned manually" note below — have been folded into the steps as written now; this isn't the original docs-only guess anymore.

### Before you start

- The code is already on GitHub (`YinChingZ/MMD`); Railway needs access to that repo.
- Generate an `ENCRYPTION_KEY` ahead of time: `openssl rand -base64 32` — save it, step 2 needs it. Railway won't generate this value for you.
- A Railway account (railway.app, GitHub login works).

### Step 1: create a Project with 3 services

One Railway Project holds 3 services: the Postgres plugin, `api`, and `web`. This is a monorepo (one repo, two Dockerfiles), so `api`/`web` are the *same* GitHub repo imported twice, not two different repos:

1. Railway dashboard → "New Project" → "Deploy from GitHub repo" → pick `YinChingZ/MMD`. This creates the first service — rename it `api`.
2. Inside the project, "+ New" → "Database" → "Add PostgreSQL" for a managed Postgres.
3. Inside the project, "+ New" → "GitHub Repo" → the same `YinChingZ/MMD` repo again, creating a second service — rename it `web`.

### Step 2: configure the `api` service

**Settings → Source**: leave Root Directory **blank** — this is the easiest thing to get wrong. Root Directory controls which files get pulled into the build; set it to `apps/api` and `packages/*` never make it into the build context, so `npm ci` can't create the workspace symlink (`node_modules/@mmd/protocol -> ../packages/protocol`) and the build fails. Set Dockerfile Path to `apps/api/Dockerfile`.

**Variables** tab, add two:
- `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway's variable-reference syntax — points straight at the Postgres plugin's generated connection string, no copy-pasting, and it stays correct if Postgres credentials ever rotate)
- `ENCRYPTION_KEY` = the value generated above

**Manually add a `PORT` variable and pin it (e.g. `PORT` = `3000`) — don't count on referencing Railway's auto-injected one from `web`.** This is a real gotcha found by actually deploying it: Railway does inject `PORT` into the container's runtime environment, but that's an implicit process env var, not something stored in the Variables panel that other services can reference via `${{api.PORT}}`. In practice, `${{api.PORT}}` resolved to empty, so `web`'s constructed internal URL ended up as `http://api.railway.internal` (no port, defaulting to 80), and every proxied request failed with `ECONNREFUSED`. Manually setting `PORT` as a real Variable makes it an actual referenceable/pinnable value. The container's `CMD` (`npm run db:migrate && npm run start`) runs migrations on its own at boot.

**Networking**: no Public Networking needed here — only `web` talks to this service, over the internal network.

### Step 3: configure the `web` service

**Settings → Source**: set Dockerfile Path to `apps/web/Dockerfile`.

**Variables**: add `API_BASE_URL` set to `http://api.railway.internal:3000` (matching whatever you pinned `PORT` to in step 2; internal addressing is `<service-name>.railway.internal`, zero-config, encrypted over WireGuard automatically — no need to expose `api` publicly). Note: `apps/web/Dockerfile` declares this as a build-time `ARG API_BASE_URL` — Railway automatically passes a matching Variable through as that build arg, no separate "build arguments" setting to hunt for. But since the value gets baked into `.next/routes-manifest.json` at build time, **confirm the Deployments tab actually shows a fresh build** after changing this Variable — it's not something a runtime env var refresh alone would pick up (confirmed the hard way: testing right after changing the Variable but before the new build finished still hit the old baked-in address).

**Networking**: Settings → Networking → "Generate Domain" for a `*.railway.app` domain with automatic HTTPS issuance/renewal — which happens to satisfy the earlier requirement that the anonymous workspace cookie needs HTTPS in production. For a custom domain, add it here and follow the prompts to add a CNAME + a TXT record on your own DNS.

### Step 4: first deploy and verification

Both services' Deployments tabs show build logs. Worth confirming:
- `api`'s build log shows `npm run db:migrate` completing (should print something like "Applied: 0001_init.sql, ..." for all 7 migrations).
- `api`'s runtime log shows `No ./models.config.json found — using MockProvider` (unless you deliberately mounted a model registry) — the expected state for pure BYOK mode.
- Open `web`'s public domain and walk the full flow — create a conversation → submit a mock-mode run → wait for `completed` → see the result — confirming it matches the behavior already verified against `npm run dev`/`docker compose`.
- Quick way to check the `web → api` internal proxy without opening a browser: `curl -i https://<your web domain>/api/conversations`, expecting `200` + `{"conversations":[]}` + a `Set-Cookie` header carrying `Secure`/`HttpOnly` (this is exactly the command that surfaced the PORT gotcha above during the 2026-07-05 real deploy). A plain-text `500 Internal Server Error` with no JSON body means `API_BASE_URL` is pointing at the wrong internal address/port — go back and check step 3.

### Day-to-day operations

- **Shipping a new version**: pushing to the tracked GitHub branch auto-triggers a rebuild/redeploy of both services by default — no manual step needed.
- **Restarts interrupt in-flight runs**: see "What happens to a run in flight when the server restarts/redeploys" above — `reconcile-runs.ts` automatically marks any stuck run failed on the next boot; no extra ops action needed, just set expectations up front.
- **Logs**: each service's Deployments → a specific deployment → Logs, or the Railway CLI's `railway logs`.
- **Rollback**: pick a previously-successful deployment on the Deployments tab and hit "Redeploy".

## Verification status

Implementation started with a Docker-free local file-copy simulation to de-risk the two biggest unknowns, then was verified for real once a machine with Docker became available:

- ✅ `docker build -f apps/api/Dockerfile .` and `docker build -f apps/web/Dockerfile .` both build successfully.
- ✅ `docker compose up --build` brings up all three services correctly: `postgres` passes its healthcheck, `api` runs all 6 migrations automatically on container start, `web` renders the home page correctly.
- ✅ Walked the full user flow through the `web` container's rewrite proxy (`http://localhost:3001/api/...`, not hitting the `api` container's port directly): create a conversation → submit a BYOK run with a fake API key and `save: true` (exercising the key-save/encryption path) → queried the container's Postgres directly to confirm the encrypted column contains no plaintext key → submitted a run using the default (mock) models and waited for it to reach `completed`, with `GET /result` correctly returning `final_answer`/`cost`.
- ✅ The fake-key BYOK run received a real 401 from OpenAI as expected (confirming outbound network access works from the container), was correctly marked `failed` with a clear error message, and didn't crash the `api` container.
- ✅ Also confirmed the `Secure` cookie behavior mentioned in "Production requires HTTPS" above — `docker compose`'s `Set-Cookie` header does carry `Secure`.
- All test containers/volumes/images were torn down after verification, leaving no residue.

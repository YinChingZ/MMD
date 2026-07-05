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

## Deploying to Railway (one reference path)

A concrete walkthrough rather than a vague "use Docker," using [Railway](https://railway.app) as the reference (GitHub integration, automatic Dockerfile detection, one-click Postgres plugin — a good fit for a solo developer); Fly.io/Render follow similar core steps (build the image → set env vars → connect a managed Postgres).

1. **Create a new project**, importing from the GitHub repo.
2. **Add a Postgres plugin** ("New" → "Database" → "PostgreSQL"), which generates a `DATABASE_URL` automatically.
3. **Add the apps/api service**: same repo, leave Root Directory blank (build context must be the repo root), set Dockerfile Path to `apps/api/Dockerfile`. Environment variables:
   - `DATABASE_URL`: reference the Postgres plugin's generated variable (Railway supports variable references like `${{Postgres.DATABASE_URL}}`).
   - `ENCRYPTION_KEY`: generate manually (`openssl rand -base64 32`) and store in Railway's Variables panel.
   - Railway injects `PORT` automatically — no need to set it.
4. **Add the apps/web service**: same repo, Dockerfile Path `apps/web/Dockerfile`. Set the `API_BASE_URL` build argument to apps/api's Railway internal address (something like `http://<api-service>.railway.internal:<port>`, which Railway shows under the api service's Settings → Networking) — remember this is build-time, so changing it needs a rebuild, not just an env var update.
5. **Enable Public Networking on the apps/web service** so visitors can reach it; `apps/api` doesn't need a public entrypoint if it's only reached over the internal network by `apps/web`.

## Verification status

Implementation started with a Docker-free local file-copy simulation to de-risk the two biggest unknowns, then was verified for real once a machine with Docker became available:

- ✅ `docker build -f apps/api/Dockerfile .` and `docker build -f apps/web/Dockerfile .` both build successfully.
- ✅ `docker compose up --build` brings up all three services correctly: `postgres` passes its healthcheck, `api` runs all 6 migrations automatically on container start, `web` renders the home page correctly.
- ✅ Walked the full user flow through the `web` container's rewrite proxy (`http://localhost:3001/api/...`, not hitting the `api` container's port directly): create a conversation → submit a BYOK run with a fake API key and `save: true` (exercising the key-save/encryption path) → queried the container's Postgres directly to confirm the encrypted column contains no plaintext key → submitted a run using the default (mock) models and waited for it to reach `completed`, with `GET /result` correctly returning `final_answer`/`cost`.
- ✅ The fake-key BYOK run received a real 401 from OpenAI as expected (confirming outbound network access works from the container), was correctly marked `failed` with a clear error message, and didn't crash the `api` container.
- ✅ Also confirmed the `Secure` cookie behavior mentioned in "Production requires HTTPS" above — `docker compose`'s `Set-Cookie` header does carry `Secure`.
- All test containers/volumes/images were torn down after verification, leaving no residue.

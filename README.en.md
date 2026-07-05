# MMD — Multi-Model Deliberation

[![CI](https://github.com/YinChingZ/MMD/actions/workflows/ci.yml/badge.svg)](https://github.com/YinChingZ/MMD/actions/workflows/ci.yml)

*[中文](README.md)*

Multiple LLMs deliberate through a six-phase protocol — Propose → Critique → Revise → Normalize → Vote → Compose — producing a final answer annotated with consensus strength and traceable back to every model's original claims.

## Status

**M0 (protocol hardening) + M1 (CLI prototype) + M1.5 (convergence check, go decision) + v0.2 (planning mode for long-form output) + M2 (Backend API) + M3 (Web MVP) + M4 (BYOK platform) + M5.1 (cost circuit breaker) + M5.2 (CI) + M5.3 (rate limiting & data cleanup) + M5.4 (deployment docs/Dockerfile) are all complete**, and all of them have been validated end-to-end with real models (not just mocks). `apps/cli` supports three modes: `standard` (all six phases, default), `quick` (skips critique/revise/vote), and `planning` (splits the question into topics, for long-form/comprehensive planning output). `apps/api` moves the same orchestrator logic (now extracted into `packages/orchestrator`, shared by both CLI and API) onto a Fastify + Postgres server: a Conversation/Run API, an SSE event stream (replayable on reconnect via `Last-Event-ID`), and persisted run results. `apps/web` is the Next.js frontend that consumes that API: ask a question, pick models, watch the run progress live, expand the original claims behind each consensus point, copy the final answer. M4 is BYOK (bring your own key): no login/account system — users pick a provider from a small whitelist and supply their own API key, which is used transiently by default and can optionally be saved encrypted under an anonymous, cookie-scoped workspace (no registration required). M5.1 is the cost circuit breaker: every run has a USD cost cap (default $5, overridable per run), accumulated across phases from each call's real usage, that stops the run before the next phase starts if exceeded — so a BYOK user's key can't get run up unknowingly. M5.2 is CI: `.github/workflows/ci.yml` runs the full-workspace build/migrate/test against a real Postgres service container; along the way it surfaced and fixed a real, previously-unhit bug — the root `build` script ran workspaces in npm's default alphabetical order, which conflicts with the dependency order required by TypeScript project references, guaranteed to fail on any genuinely fresh checkout (like CI) even though it had never once failed locally, since the local `dist/` directories had never been wiped clean in this project's history. M5.3 is rate limiting & data cleanup: `POST /api/conversations/:id/runs` is now rate-limited per workspace (10/minute), a new `DELETE /api/conversations/:id` cascades to every dependent row for that conversation, and a standalone cleanup script deletes anonymous workspaces inactive for over 30 days — which required a migration adding `ON DELETE CASCADE` to foreign keys that previously had none, since deletes would otherwise fail on the first dependent row. M5.4 is deployment docs/Dockerfile: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `docker-compose.yml`, and [docs/deployment.en.md](docs/deployment.en.md). Fully verified against real Docker — `docker build` plus `docker compose up --build` bringing up both containers and walking the complete "create conversation → add BYOK key → submit run → see result" flow — and along the way surfaced and fixed two real issues: apps/api's workspace packages have `package.json` `"main"` fields pointing straight at `.ts` source, so running the compiled output via plain `node dist/main.js` fails immediately with a module-not-found error, fixed by running the container via `tsx` at runtime instead (the same path `npm run dev` already takes); and apps/web's `API_BASE_URL` only takes effect once, at build time (baked into Next.js's rewrite manifest) — changing it at runtime has no effect. See [multi-model-deliberation-dev-roadmap.md](multi-model-deliberation-dev-roadmap.md) (in Chinese; includes real-run findings and data) for the full milestone plan.

## The six-phase protocol

| Phase | Description |
|------|------|
| Propose | Each model only sees the user's question, answers independently, and breaks its answer into claims |
| Critique | Each model reviews the other models' claims |
| Revise | Each model updates its own position based on the critiques it received |
| Normalize | Semantically similar claims are merged into candidate claims (must keep `source_claim_ids` for traceability) |
| Vote | Each model votes on the candidate claims |
| Compose | The final answer is generated from a ratio-based consensus classification (strong / qualified / disputed / rejected) |

`standard`/`quick` modes run these six phases directly. `planning` mode adds an **Outline** phase up front (a single coordinator call splits the question into up to 8 topics), then runs the six-phase protocol once per topic in parallel, and finally emits output sectioned by topic.

The protocol's hard constraints — ratio-based consensus, run-scoped ids, quorum-based degradation, latency/cost budgets, quick/planning mode, and why the outline phase uses a single coordinator instead of multi-model deliberation — are documented in [docs/protocol.en.md](docs/protocol.en.md).

## Why this is different from a plain "ask N models and merge"

- **No final judge model.** There is no single model (or human-picked "best" model) that reads everyone's answers and decides what's true. Consensus is computed by a pure, auditable function (`classifyCandidate`) over the votes themselves — a critical objection from *any* model can never be silently outvoted by a majority, and the classification logic doesn't hardcode the number of models.
- **Traceability is a protocol-level constraint, not a UI nice-to-have.** Every candidate claim produced by the Normalize phase carries `source_claim_ids`, a required, non-empty field. Any surface that renders the final answer must be able to trace every merged point back to the original, pre-merge claims from each model — because merging claims is itself an implicit judgment call, and transparency is the only real safeguard against it.
- **Degradation, not all-or-nothing failure.** Each phase has an explicit quorum. One model timing out or erroring marks that phase (and the affected content) as `partial` instead of failing the whole run.

## Monorepo layout

```
apps/
  cli/                 # M1: the CLI entry point that runs the whole pipeline
  api/                  # M2: Fastify + Postgres backend (Conversation/Run API, SSE event stream)
  web/                  # M3: Next.js frontend (question input, model selection, run progress, consensus panel)
packages/
  protocol/             # zod schemas + pure functions for consensus classification / quorum / ids / budget
  model-adapters/       # provider adapters: mock, OpenAI-compatible, quorum-aware fan-out
  prompts/              # prompt construction for the six phases
  orchestrator/         # propose->critique->revise->normalize->vote->compose orchestration, shared by CLI and API
docs/
  protocol.md           # protocol rules (Chinese)
  protocol.en.md         # protocol rules (English)
```

## Quickstart

```bash
npm install
```

### Run once with the mock provider (no API key needed)

```bash
cd apps/cli
npm run start -- --question "Should a small team adopt a monorepo?" --mode standard
```

If `models.config.json` doesn't exist (or you pass `--provider mock`), the CLI falls back to `MockProvider`, simulating three models (`model_a,model_b,model_c` by default) with no real network calls. Results are written to `apps/cli/out/<runId>.json` and `.md`, and printed to the terminal.

### Planning mode: long-form output / comprehensive planning

```bash
npm run start -- --question "Plan the tech stack for a 3-person e-commerce project" --mode planning
```

This runs an outline pass first (splitting the question into up to 8 topics), then runs the full six-phase protocol per topic in parallel, and emits a planning document sectioned by topic (`## Executive Summary` plus one section per topic). With real models, the six-phase cost of a single topic is comparable to one `standard`-mode run (see the real-run latency baseline in [docs/protocol.en.md](docs/protocol.en.md)); since topics run in parallel, total wall-clock time is roughly bounded by the slowest topic, not the sum of all topics.

### Wiring up real models

```bash
cp apps/cli/models.config.example.json apps/cli/models.config.json
cp apps/cli/.env.example apps/cli/.env
```

Edit `models.config.json` and fill in a real `modelId` / `baseUrl` for each model (any OpenAI-compatible `/chat/completions` endpoint works), then set the environment variable named by each `apiKeyEnvVar` in `.env`. Both files are already gitignored and won't be committed.

### CLI flags

| flag | description |
|------|------|
| `--question`, `-q` | The question to deliberate on |
| `--mode` | `standard` (default, all six phases), `quick` (skips critique/revise/vote), or `planning` (splits by topic, for long-form/comprehensive output) |
| `--models`, `-m` | Comma-separated model ids to use with the mock provider |
| `--fail-models` | Model ids to simulate as failing, when using the mock provider — for testing quorum degradation |
| `--config`, `-c` | Path to the models config, default `./models.config.json` |
| `--provider mock` | Force the mock provider even if a config file exists |
| `--out`, `-o` | Output directory, default `./out` |

## Backend API (M2)

```bash
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env      # adjust DATABASE_URL/PORT if needed
cd apps/api
npm run db:migrate
npm run start
```

Falls back to `MockProvider` when `apps/api/models.config.json` doesn't exist, same as the CLI. `ENCRYPTION_KEY` is a required env var (generate with `openssl rand -base64 32`), used to encrypt any BYOK keys a user opts into saving — see `.env.example`. Core endpoints:

| Endpoint | Description |
|------|------|
| `GET /api/models` | List selectable server-registry models (`id`/`providerLabel`/`isCoordinator`) |
| `GET /api/providers` | List the BYOK provider whitelist (`providerId`/`displayName`, no baseUrl exposed; includes an optional `suggestedRate` the frontend uses to pre-fill the custom pricing inputs) |
| `POST /api/conversations` | Create a conversation, tagged with the visitor's anonymous workspace cookie |
| `GET /api/conversations` | List the current workspace's conversations (most recently active first — other workspaces' conversations are never visible) |
| `GET /api/conversations/:id` | View a conversation and its runs (404 if it belongs to a different workspace) |
| `POST /api/conversations/:id/runs` | Start a deliberation run (`question`/`mode`/optional `modelIds` from the server registry, and/or optional `byokModels` — either a fresh `{providerId, modelId, apiKey}` or a `savedKeyId` reference to a previously-saved key — plus optional `costLimitUsd`, defaulting to $5 when omitted, see "cost circuit breaker" below) |
| `GET /api/runs/:id` | Check run status |
| `GET /api/runs/:id/result` | Get the final result (409 while still running), including `cost: {totalUsd, limitUsd, hasUnknownPricing}` |
| `GET /api/runs/:id/events` | SSE event stream, replayable on reconnect via `Last-Event-ID` |
| `GET /api/workspace/keys` | List the current workspace's saved BYOK keys (provider/model/label metadata only, never the plaintext) |

## Web MVP (M3)

```bash
cd apps/web
cp .env.example .env      # API_BASE_URL defaults to http://localhost:3000
npm run dev                # port 3001, proxies /api/* to apps/api via same-origin rewrites
```

Open `http://localhost:3001`: create a conversation, ask a question, pick a mode (`standard`/`quick`/`planning`) and models, then watch phase-by-phase progress live over SSE. Once complete, it shows the final answer, a consensus panel (each candidate expandable to show the original pre-merge claims), and a collapsed-by-default discussion process. `planning` mode additionally shows the outline step and one independent progress row per topic. In dev, `next.config.ts` explicitly disables Next's built-in gzip compression (`compress: false`) — leaving it on buffers the proxied SSE response and silently breaks live progress updates, a real bug caught while testing against real models.

Below the model list is "Add your own API key" (M4 BYOK): pick a provider from the whitelist (OpenAI/DeepSeek/OpenRouter/Volcengine), enter your own API key and model id, and add it to the run. Optionally check "remember this key" to save it, encrypted, under this device's anonymous workspace — next time, it shows up under "Saved keys on this device" for one-click reuse without the browser holding the plaintext again. Next to it is an optional custom pricing input ($/1M tokens, input and output), pre-filled with a server-computed suggestion (updates when you switch providers) that you can accept as-is, replace with a rate you actually know, or clear — the built-in rate table is inevitably a stale snapshot, and the person actually paying the bill can keep it current better than we can. Checking "remember" persists it alongside the key.

Above the submit button is the cost limit (M5.1, default $5, editable): the run accumulates each model call's real cost across phases (a model with a custom rate uses that; everything else uses the built-in approximate table or OpenRouter's real reported cost) and stops before the next phase starts if it crosses this limit (rather than running to completion and failing at the very end). The completed result also shows the actual cost incurred.

## Development

```bash
npm run test    # unit tests across all workspaces (apps/api's integration tests need DATABASE_URL, and are skipped without it)
npm run build   # TypeScript build across all workspaces
```

## Related docs

- [docs/protocol.en.md](docs/protocol.en.md) — how the protocol constraints are implemented
- [docs/protocol.md](docs/protocol.md) — the same, in Chinese
- [docs/prior-art.en.md](docs/prior-art.en.md) — how MMD compares to OpenRouter Fusion Router, litesquad, and the LiteLLM ecosystem
- [multi-model-deliberation-dev-roadmap.md](multi-model-deliberation-dev-roadmap.md) — milestone plan and risk register (Chinese)

# MMD — Multi-Model Deliberation

*[中文](README.md)*

Multiple LLMs deliberate through a six-phase protocol — Propose → Critique → Revise → Normalize → Vote → Compose — producing a final answer annotated with consensus strength and traceable back to every model's original claims.

## Status

**M0 (protocol hardening) + M1 (CLI prototype) + M1.5 (convergence check, go decision) + v0.2 (planning mode for long-form output) are all complete**, and all of them have been validated end-to-end with real models (not just mocks). `apps/cli` supports three modes: `standard` (all six phases, default), `quick` (skips critique/revise/vote), and `planning` (splits the question into topics, for long-form/comprehensive planning output).

The `litellm-integration` branch is now **LiteLLM-first**: it pivots the next milestone away from a standalone Backend API / Web MVP and toward an open-source Fusion-like router/provider capability optimized for LiteLLM integration convenience, upstream acceptance, and community impact. See [docs/litellm-integration.md](docs/litellm-integration.md) and [multi-model-deliberation-dev-roadmap.md](multi-model-deliberation-dev-roadmap.md) for the detailed plan.

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
packages/
  protocol/             # zod schemas + pure functions for consensus classification / quorum / ids / budget
  model-adapters/       # provider adapters: mock, OpenAI-compatible, quorum-aware fan-out
  prompts/              # prompt construction for the six phases
python/
  mmd_litellm/          # M2': LiteLLM-shaped Python/Pydantic PoC
docs/
  protocol.md           # protocol rules (Chinese)
  protocol.en.md         # protocol rules (English)
  litellm-integration.md # LiteLLM integration pivot design (Chinese)
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

## Development

```bash
npm run test    # unit tests across all workspaces
npm run build   # TypeScript build across all workspaces
```

### LiteLLM PoC (M2')

```bash
uv run --project python --extra test pytest
```

The Python PoC now includes the `mmd/fusion` custom provider shell, Pydantic protocol core, quick mode, standard mode, and OpenAI-compatible responses. When `return_trace=true`, the LiteLLM Proxy HTTP response includes provider-specific MMD trace metadata at the top-level `mmd` field with `trace_version: 1`; the default `return_trace=false` path keeps normal `choices[].message.content` unchanged.

Local LiteLLM Proxy HTTP smoke test (scripted mock panel, no real model keys):

```bash
uv run --project python --extra proxy python python/scripts/proxy_smoke.py
```

Next M2' development order: real-model Proxy smoke → Python planning mode → LiteLLM Router/callback integration → upstream readiness cleanup.

## Related docs

- [docs/protocol.en.md](docs/protocol.en.md) — how the protocol constraints are implemented
- [docs/protocol.md](docs/protocol.md) — the same, in Chinese
- [docs/litellm-integration.md](docs/litellm-integration.md) — LiteLLM integration pivot design (Chinese)
- [docs/prior-art.en.md](docs/prior-art.en.md) — how MMD compares to OpenRouter Fusion Router, litesquad, and the LiteLLM ecosystem
- [multi-model-deliberation-dev-roadmap.md](multi-model-deliberation-dev-roadmap.md) — milestone plan and risk register (Chinese)

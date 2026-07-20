# MMD — Multi-Model Deliberation

[![CI](https://github.com/YinChingZ/MMD/actions/workflows/ci.yml/badge.svg)](https://github.com/YinChingZ/MMD/actions/workflows/ci.yml)

*[中文](README.md)*

MMD is an audit-first, claim-level multi-model deliberation workbench. It preserves claim lineage, revisions, objections, classifier inputs, and call audits, then computes support labels deterministically instead of asking one judge model to declare consensus.

## Current protocol

New runs use `mmd.v3` and write `mmd.trace.v3`:

| Mode | Governance | Current status | Core path |
|---|---|---|---|
| Quick | centralized | Product path, exactly N=2 | Propose → Normalize → Classify → Compose |
| Standard-C | centralized | Default/compatible path | Propose → Critique → Revise → Normalize → Vote → Classify → Compose |
| Standard-D | distributed/peer-governed | Experimental, manifest-gated | Propose → Critique → Revise → Align → complete-link → Vote → Classify → Compose |
| Planning | centralized | Product path | Outline → per-topic ledgers → one GlobalCompose |

The host orchestrator always owns scheduling, IDs, quorum, deterministic classification, persistence, and failure semantics. The LLM coordinator is only a model role used in specified phases such as Normalize, Compose, Outline, or GlobalCompose. Standard-D does not mean “no orchestrator.”

Planning v3 no longer runs per-topic SectionCompose. Its authoritative result is one `PlanningFinalAnswer`; the old `PlanDocument` remains only as a compatibility projection for existing CLI/UI/readers.

See [docs/protocol.en.md](docs/protocol.en.md) for protocol details and [docs/versioning.en.md](docs/versioning.en.md) for version boundaries.

## Project status

- **M0–M5**: protocol hardening, CLI, Backend API, Web MVP, BYOK, cost breaker, CI, cleanup, deployment, and share links are complete.
- **M6.1–M6.6**: custom JSON, per-model and claim-level streaming progress, Compose streaming, multimodal input, and the optional web-search/tool path are complete. Historical design and verification notes live in [docs/roadmap.md](docs/roadmap.md).
- **Protocol v3**: Quick N=2, Standard-C/D, Planning GlobalCompose, trace v3, and independent artifact persistence are implemented.
- **Still research targets**: a CN/DN 2×2 runner sharing one post-revision root, Standard-D deterministic-render/fidelity gates, an explicit classification-basis kind, complete prompt/provider version ledgers, and the formal main/LiteLLM parity gate.

## Why this is more than “ask N models and merge”

- **Claim-level deliberation**: long answers become claims, then normalized candidates that are voted and classified individually.
- **Lineage is a data constraint**: candidates require `source_claim_ids`; Planning spans carry candidate lineage.
- **Classification is separate from prose**: the classification ledger is authoritative, and Compose failure returns a deterministic fallback.
- **Objections cannot disappear silently**: objection severity participates in deterministic classification.
- **Failures retain intermediate artifacts**: trace/artifact persistence is separate from final run status.

This does not eliminate coordinator risk. Normalize false merges/splits, Compose dispute laundering, model-identity bias, and consensus calibration remain explicit research questions; see [docs/prior-art.en.md](docs/prior-art.en.md).

## Monorepo

```text
apps/
  cli/                 # Command-line entry point
  api/                 # Fastify + Postgres, Conversation/Run API, SSE, trace API
  web/                 # Next.js workbench
packages/
  protocol/            # Schemas, classification, quorum, governance, trace v3
  model-adapters/      # Mock/OpenAI-compatible/provider routing
  prompts/             # Phase prompts
  orchestrator/        # Shared host orchestration for every mode/governance
contract/
  mmd-protocol-v3/     # Language-neutral schema, errors, and parity fixtures
benchmarks/
  hle/                 # HLE adapter
docs/                  # Protocol, versioning, history, deployment, and prior art
```

## Quickstart

```bash
npm install
```

### Standard mock run

```bash
cd apps/cli
npm run start -- --question "Should a small team adopt a monorepo?" --mode standard
```

Without `models.config.json`, or with `--provider mock`, the CLI defaults to `model_a,model_b,model_c`.

### Quick mock run

Quick v3 requires exactly two distinct models:

```bash
npm run start -- --question "Should a small team adopt a monorepo?" \
  --mode quick --models model_a,model_b
```

A real-model configuration used for Quick must likewise select exactly two models. `Traceable-Quick-C@N3` is available only to a research manifest/runner; it is not a CLI product default.

### Planning run

```bash
npm run start -- --question "Plan the tech stack for a three-person e-commerce project" --mode planning
```

Planning creates an outline, adds the stable `cross_cutting_risks_and_omissions` topic, builds topic ledgers in parallel, and makes one GlobalCompose call with output-span lineage.

### Real models

```bash
cp apps/cli/models.config.example.json apps/cli/models.config.json
cp apps/cli/.env.example apps/cli/.env
```

Fill in OpenAI-compatible `baseUrl`/`modelId` values and the corresponding keys in `.env`. Both files are gitignored.

### CLI flags

| Flag | Description |
|---|---|
| `--question`, `-q` | Question to deliberate |
| `--mode` | `standard` (default), `quick`, or `planning` |
| `--models`, `-m` | Mock-provider model IDs; Quick requires exactly two |
| `--fail-models` | Mock-provider models to fail deliberately |
| `--config`, `-c` | Models config path, default `./models.config.json` |
| `--provider mock` | Force the mock provider |
| `--out`, `-o` | Output directory, default `./out` |

## Backend API

```bash
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env
cd apps/api
npm run db:migrate
npm run start
```

Core endpoints:

| Endpoint | Description |
|---|---|
| `POST /api/conversations/:id/runs` | Create a run with `mode`, optional `governance`, experimental `experimentManifest`, model/BYOK selection, cost limit, and M6 inputs |
| `GET /api/runs/:id` | Run status, mode, and `governance` |
| `GET /api/runs/:id/result` | Final result; Planning includes authoritative `planningFinal` and compatible `planDocument` |
| `GET /api/runs/:id/trace` | Read the persisted `mmd.trace.v3` snapshot for running, completed, or failed runs |
| `GET /api/runs/:id/events` | SSE event stream replayable through `Last-Event-ID` |

Public API requests retain camelCase; the language-neutral contract and trace use snake_case.

## Web MVP

```bash
cd apps/web
cp .env.example .env
npm run dev
```

Open `http://localhost:3001`. The current Web app supports conversations, model/BYOK selection, all three modes, live phase/claim/Compose progress, cost, consensus and lineage views, share links, and Planning results. Standard-D does not yet have an ordinary product governance selector; it remains an experimental API path enabled by an experiment manifest. Governance selection, Standard-D ledger presentation, and the Planning trace redesign belong to a separate WebUI workstream.

## Development and validation

```bash
npm run test
npm run build
```

The cross-implementation Protocol v3 contract lives in [contract/mmd-protocol-v3](contract/mmd-protocol-v3/README.md). Before formal research, main and LiteLLM must pass the same deterministic fixtures for phase, IDs, candidates, ballots, classifications, lineage, failures, quorum, and usage.

## Documentation

- [Protocol](docs/protocol.en.md) / [中文](docs/protocol.md) — current implementation semantics
- [Versioning](docs/versioning.en.md) / [中文](docs/versioning.md) — version and compatibility rules
- [Prior art](docs/prior-art.en.md) / [中文](docs/prior-art.md) — competitors, mechanism baselines, and adjacent ecosystems
- [Roadmap](docs/roadmap.md) — historical milestones and real-run findings
- [M6 historical design](docs/streaming-tools-multimodal-json.md) — M6 design and historical SectionCompose record
- [Deployment](docs/deployment.en.md) / [中文](docs/deployment.md) — deployment, migrations, and secret management

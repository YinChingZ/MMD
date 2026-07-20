# MMD Versioning and Compatibility

*[中文](versioning.md)*

This document defines the version boundaries for the MMD protocol, trace, algorithms, experiment conditions, and documentation. Its purpose is to keep runs interpretable, legacy results readable, and product modes, study conditions, and milestone labels distinct from protocol versions.

## 1. Five independent version axes

| Axis | Current example | Meaning | Bump rule |
|---|---|---|---|
| Protocol semantics | `mmd.v3` | Phase graph, mode/governance combinations, authoritative artifacts, classification, and failure semantics | Bump the major protocol identifier, such as `mmd.v4`, for an incompatible semantic change |
| Trace schema | `mmd.trace.v3` | Core exchange fields, required lineage, and field meanings | Bump when required core fields, meanings, or lineage constraints change; non-normative diagnostics belong only in `extensions` |
| Algorithm/renderer | `normalize.v3`, `complete-link.v1`, `consensus.v1`, `canonical.v1` | Deterministic implementations that can change candidates, clusters, classifications, or canonical output | Bump the affected component whenever its artifacts may change, even if the protocol remains `mmd.v3` |
| Prompt/model identity | Prompt version/hash and model/provider revision | Reproducible model-call configuration | Record a new value when prompts, templates, model snapshots, or provider routing change; complete recording is required before formal research |
| Document/study condition | Paper A `v0.4`, `Traceable-Quick-C@N3` | Research-plan revisions or manifest condition names | Version under the relevant research workflow; these do not change the protocol version |

The packages' current `0.0.0` is not a protocol version. M0–M6 and the historical Planning `v0.2` label are development milestones, not wire-compatibility identifiers.

## 2. Stable `mmd.v3` semantics

- Product modes remain `quick | standard | planning`.
- Quick is centralized only and ordinary product runs require exactly N=2.
- Standard supports centralized governance; distributed is an experimental, manifest-gated peer-governed configuration.
- Planning is centralized only and its authoritative output comes from one GlobalCompose.
- The host orchestrator always owns scheduling, IDs, quorum, deterministic computation, persistence, and failure handling. The LLM coordinator is only a model role used in specified phases.
- The classification ledger is authoritative. Model-generated prose cannot mutate ballots or classifications.

Changing one of these rules requires a new protocol version and migration notes; it must not be silently folded into `mmd.v3`.

## 3. Trace and compatibility reads

- New runs write only `mmd.trace.v3`.
- Legacy results may remain readable, but readers must not infer or fabricate candidate lineage, classification basis, or output-span lineage that the old run never stored.
- `PlanDocument` is a compatibility projection in v3; `planning_final` is the authoritative Planning artifact.
- New non-protocol diagnostics belong only in `extensions`, and consumers must not derive protocol semantics from them.
- Language-neutral contract JSON uses `snake_case`; the existing public HTTP API still accepts camelCase fields such as `experimentManifest` and `modelIds`. These are separate boundaries and do not imply each other's naming convention.
- Additive public-API fields do not automatically bump `mmd.v3`. A change that breaks existing request or response consumers requires a separate API version or an explicit deprecation period.

## 4. Implemented behavior versus research targets

Documentation must distinguish `implemented`, `experimental`, `research target`, `compatibility-only`, and `historical`:

- `implemented`: backed by schemas, consumers, and tests on the current branch.
- `experimental`: implemented but available only through a manifest or dedicated entry point, not a default product capability.
- `research target`: required by a study design but not yet fully implemented in the trace or runner, such as a complete CN/DN 2×2 run sharing one branch root, explicit prompt hashes, or a separate classification-basis kind.
- `compatibility-only`: retained for legacy UIs/readers and never fed back into the authoritative v3 result.
- `historical`: preserves the decisions and observations made at the time; add status notes and errata instead of rewriting the record as current behavior.

## 5. Bilingual and release discipline

- `README.md`/`README.en.md`, `protocol.md`/`protocol.en.md`, and `prior-art.md`/`prior-art.en.md` must change together in one commit.
- Contract schemas, examples, and documentation must pass schema validation and parity fixtures together.
- Every claim marked implemented or verified must be locatable in current source, tests, or a dated historical record.
- Known risks such as the coordinator bottleneck, false merge/split, and dispute laundering must remain in historical research documents even after Standard-D is added.

# MMD Protocol v3

*[中文](protocol.md)*

New executions on `main` use `mmd.v3`. The language-neutral wire contract,
error codes, and golden vectors live in `contract/mmd-protocol-v3/`. Legacy
results remain readable, but readers must not invent v3 lineage; new runs write
only `mmd.trace.v3`.

## Request and governance

- `mode`: `quick | standard | planning`
- `governance`: `centralized | distributed`
- Quick is centralized and requires exactly two distinct models.
- Planning v3 is centralized in its first version.
- Standard-D requires a versioned `alignment_policy` in an experiment manifest.
- The coordinator must belong to the explicitly allowed model set.

Invalid combinations return structured errors. Research thresholds belong in
the experiment manifest, not ordinary product options.

## Phase graphs

- Quick: Propose → Normalize → Classify → Compose.
- Standard-C: Propose → Critique → Revise → immutable post-revision claims →
  coordinator Normalize → Vote → Classify → Render.
- Standard-D: peer Align replaces coordinator Normalize. The host performs
  stable complete-link clustering and enforces cannot-link.
- Planning: Outline → per-topic Standard-C ledgers → one GlobalCompose. A stable
  `cross_cutting_risks_and_omissions` topic is always present.

Planning no longer executes per-topic SectionCompose. The old `PlanDocument` is
only a compatibility projection; GlobalCompose is authoritative. Every output
span cites `source_candidate_ids`. Cross-topic derivations use
`coordinator_synthesis`, and omitting a strong candidate requires a reason.

The classification ledger is authoritative in every mode. Model rendering may
improve prose but may not mutate ballots or classifications. A failed renderer
returns a deterministic canonical fallback.

## IDs, quorum, failure, and capacity

The host assigns artifact, candidate-set, candidate, call, and output-span IDs.
Wire JSON is snake_case. Quorum is `ceil(N × 2/3)`.

Coordinator phases run one initial generation plus exactly one retry. Exhausted
retries preserve completed artifacts and return a structured partial fallback.
An Align quorum failure affects only its distributed candidate set.

Before GlobalCompose, the implementation uses model token/context metadata.
When input is too large, it performs one traceable topic-brief compression. A
second failure returns topic ledgers plus a structured fallback.

## `mmd.trace.v3`

The trace contains immutable proposals/revised claims, artifact parents,
candidate sets, Align and clustering logs, ballots, classification basis,
rendering sources, GlobalCompose lineage, call attempts, quorum, partial
failures, usage, cost, latency, and all protocol/algorithm versions.

Non-contract diagnostics belong only in `extensions` and cannot define protocol
semantics.

## Persistence and acceptance

Run status is stored separately from artifacts. Each completed phase is saved
through the trace callback into `run_traces`/`run_artifacts`; later failures do
not erase completed work. Final envelopes and authoritative Planning output are
also stored on `run_results`.

TypeScript and Python execute the shared fixtures and compare phase, IDs,
ballots, classifications, basis, lineage, failures, quorum, and usage—not only
the final text. Complete-link property tests cover order independence,
cannot-link safety, and exactly-one-cluster assignment.

# MMD Protocol v3

*[中文](protocol.md) · [Versioning and compatibility](versioning.en.md)*

This document describes the behavior of new runs on the current `main` implementation. The language-neutral contract, error codes, and parity fixtures live in [`contract/mmd-protocol-v3/`](../contract/mmd-protocol-v3/). New runs write `mmd.v3` / `mmd.trace.v3`. Legacy results may remain readable, but readers must not fabricate v3 lineage that the old run never stored.

## Host orchestrator and LLM coordinator

MMD always has a host orchestrator. It is code, not a model, and owns:

- validation of mode, governance, model selection, and experiment manifests;
- phase scheduling, retries, quorum, cost limits, and partial failures;
- artifact, candidate-set, candidate, call, and output-span IDs;
- complete-link clustering, consensus classification, and deterministic fallbacks;
- trace, artifact, and result persistence.

The LLM coordinator is a model role used only for specified calls such as centralized Normalize, Compose, Outline, and GlobalCompose. `peer-governed` means peers govern candidate formation through Align; it does not mean the system has no orchestrator.

## Request and governance

- `mode`: `quick | standard | planning`
- `governance`: `centralized | distributed`
- Quick is centralized only and ordinary product runs require exactly two distinct models.
- Standard defaults to centralized. Distributed requires an `mmd.v3` `experimentManifest` with a versioned `alignment_policy`.
- Planning is centralized only.
- The coordinator must be in the explicitly selected model set. Invalid combinations return structured configuration errors rather than silently falling back.

The public HTTP API currently uses camelCase fields such as `experimentManifest` and `modelIds`; contract artifact/trace JSON uses snake_case. These are separate compatibility boundaries.

## Phase graphs and authoritative results

### Quick: centralized N=2

```text
Propose_N → Normalize_C → Classify_host → Compose_C
```

Quick has no Critique, Revise, or explicit Vote. The host converts each candidate's distinct source models into implied approve ballots, then applies the same deterministic classifier. The current trace records those implied ballots and the full classifier inputs, but it does not yet carry a separate `source_coverage` basis-kind enum. That field should be added before formal research so these records are not conflated with Standard's explicit ballots.

An ordinary Quick run makes four model calls before retries. Paper A's `Traceable-Quick-C@N3` is a study-manifest condition, not a second product default.

### Standard-C: centralized/classic

```text
Propose_N → Critique_N → Revise_N
→ Normalize_C → Vote_N → Classify_host → Compose_C
```

Normalize forms a candidate set with `source_claim_ids`. The post-Vote classification ledger is authoritative. Compose may render the ledger as prose, but it cannot change ballots or classifications; failure returns a deterministic canonical fallback.

The no-retry call count is `4N + 2`, or 14 at N=3.

### Standard-D: distributed/peer-governed, experimental

```text
Propose_N → Critique_N → Revise_N
→ Align_N → complete-link_host → Vote_N → Classify_host → Compose_C
```

Each peer judges revised claim pairs as `equivalent | distinct | conflict | uncertain`, with cannot-link, confidence, and a reason. The host applies conservative, stable complete-link clustering: cannot-link pairs never merge, every revised claim belongs to exactly one cluster, and insufficient evidence keeps claims separate.

The current implementation still makes one coordinator Compose call as a presentation layer, so its no-retry count is `5N + 1`, or 16 at N=3. The classification ledger remains authoritative, but the research report's deterministic-render endpoint, explicit non-authoritative-prose marker, and fidelity checker are not yet complete. A research endpoint that skips Compose would make 15 calls at N=3.

The current product/API executes either C or D in one run. A shared post-revision root with both CN/DN branches and all CN+CR, CN+DR, DN+CR, and DN+DR cells remains a research target, not a current product capability.

### Planning: centralized + GlobalCompose

```text
Outline_C
→ add cross_cutting_risks_and_omissions_host
→ parallel topics:
   Propose_N → Critique_N → Revise_N → Normalize_C → Vote_N → Classify_host
→ GlobalCompose_C
```

Planning v3 no longer calls per-topic SectionCompose. Every topic ledger remains in the trace, and one GlobalCompose produces the authoritative `PlanningFinalAnswer`. Each substantive span receives a host-assigned `span_id` and candidate lineage. Cross-topic derivations use `coordinator_synthesis`; omitting a strong candidate requires a reason.

The current capacity guard checks whether serialized candidate input exceeds 60,000 characters, truncates each candidate text to 1,200 characters while recording a `topic_briefs` artifact, and checks once more. It does not yet use model context-window metadata, nor are the briefs coordinator-generated semantic summaries. Those are follow-up targets from the research report, not current behavior.

The no-retry call count is `2 + T(4N + 1)`, where T is the actual topic count; the Outline and GlobalCompose calls sit outside the topic calls.

`PlanDocument` is still derived in code from `planning_final` and the topic ledgers for existing CLI/UI/readers. It is not authoritative in v3 and is never fed back into GlobalCompose.

## Classification basis and lineage

- Candidate-set and candidate IDs are host-assigned; model-supplied IDs are overwritten.
- Quick currently records coverage-derived implied ballots; Standard records explicit ballots.
- `classification_basis` records candidate set, expected voter count, ballots, approve ratio, label, and partial status.
- The current schema has no separate `basis_kind`; documentation and study data must not claim that the field name alone distinguishes the two evidence types.
- Standard-D records alignment judgments, policy, and merge/reject decisions.
- Planning records topic-to-candidate-to-output-span lineage.

## Quorum, retries, and failure

Quorum is `ceil(N × 2/3)`. A fan-out phase may continue after some models fail if quorum remains met, marking the result partial. A required panel phase below quorum terminates the current flat run. Planning uses `Promise.allSettled` to isolate topics and fails the whole Planning run only when every topic fails.

Structured coordinator calls support schema repair and at most one additional retry after a provider failure. Every attempt contributes usage and cost; baseline call counts above exclude retries and repairs.

Current fallback rules:

- Normalize_C failure: derive a deterministic fallback candidate set from the existing claims and preserve completed artifacts.
- Compose_C failure: return a deterministic canonical ledger rendering.
- Align below quorum in a standalone Standard-D run: fail the current distributed run. Only a future paired 2×2 runner should mark the DN branch failed while retaining CN.
- Outline_C failure: retain only the fixed `cross_cutting_risks_and_omissions` topic and continue.
- One Planning topic failure: continue with the others.
- GlobalCompose_C failure or input still over budget after compression: preserve topic ledgers and return a structured fallback with candidate lineage.

## `mmd.trace.v3` and persistence

The current trace records:

- proposals, immutable post-revision claims, and artifact parents;
- candidate sets, Align/clustering decisions, ballots, and classifier inputs;
- Planning span lineage and strong-candidate omission reasons;
- call phase/model/role/attempt/status, usage, cost, and latency;
- quorum, failures, and normalization/alignment/decision-rule/renderer versions.

The trace does not yet fully record the research plan's prompt version/hash, provider revision, or a separate classification-basis kind. These remain parity/research-gate requirements and must not be documented as complete.

Run status and artifacts are persisted separately. As each artifact completes, the API trace callback updates `run_traces` and `run_artifacts`. The final envelope is also stored in `run_results.trace`, and authoritative Planning output in `run_results.planning_final`. A later phase failure does not delete earlier artifacts.

## Contract and acceptance

The TypeScript and Python implementations must execute `contract/mmd-protocol-v3/fixtures/` and compare phase, IDs, candidate sets, ballots, classifier inputs, lineage, failures, quorum, and usage—not just final prose. Complete-link property tests must prove that:

- input and response order do not change the result;
- cannot-link pairs never merge;
- every raw claim belongs to exactly one cluster.

See [versioning.en.md](versioning.en.md) for upgrade and legacy-read rules.

# MMD Protocol/Architecture v3

## Boundary

MMD is a multi-call meta-provider. LiteLLM owns provider routing, credentials,
fallbacks, native response/exception types, usage/cost calculation, streaming
chunks, callbacks, and Proxy registration. MMD owns only the deterministic
deliberation protocol and its audit trace.

The language-neutral contract is `contract/mmd-protocol-v3/`. New executions
write only `mmd.trace.v3`; existing v1/v2 stored JSON may still be displayed as
legacy data but must never be upgraded by inventing v3 lineage.

## Request contract

- `mmd_mode`: `quick`, `standard`, or `planning`.
- `governance`: `centralized` or `distributed`.
- Quick requires centralized governance and exactly two distinct models.
- Planning v3 initially requires centralized governance.
- Standard-D requires an `experiment_manifest` containing a versioned
  `alignment_policy`; it is not a normal product default.
- `coordinator_model`, when supplied, must be one of `analysis_models`.

Invalid combinations return structured provider errors; there is no silent
governance or model fallback.

## Phase graphs

- Quick: Propose → Normalize → Classify → Compose.
- Standard-C: Propose → Critique → Revise → immutable post-revision claims →
  coordinator Normalize → Vote → Classify → deterministic ledger → Compose.
- Standard-D: the same flow except peer Align replaces coordinator Normalize;
  the host performs stable complete-link clustering and enforces cannot-link.
- Planning: Outline → per-topic Standard-C ledgers → one GlobalCompose. A stable
  `cross_cutting_risks_and_omissions` topic is always included.

Compose is optional presentation: deterministic classifications remain
authoritative. GlobalCompose spans cite `source_candidate_ids`; cross-topic
derivations use `coordinator_synthesis`, and omitted strong candidates require
an explicit reason.

## Failure and capacity behavior

Coordinator phases perform one initial generation and exactly one retry. If
both fail, completed claims/ballots/ledgers remain available and a structured
deterministic fallback is returned. Distributed Align quorum failure fails only
that candidate set. Planning topic failures do not erase surviving topics.

Before GlobalCompose, the adapter uses LiteLLM token counting and model context
metadata where available. If input would exceed 80% of the context window, it
performs one traceable topic-brief compression. If composition still fails, the
response contains topic ledgers plus a structured fallback.

## Trace

`mmd.trace.v3` uses snake_case and records:

- immutable artifacts and parent IDs;
- candidate sets, alignment judgments, cluster decisions, ballots, and the
  complete classification basis;
- call IDs, attempts, status, latency, usage, cost, and unavailable counters;
- partial failures and quorum state;
- canonical rendering or GlobalCompose span lineage;
- protocol, normalization, alignment, decision-rule, and renderer versions.

Hosts assign all authoritative IDs. Model-supplied IDs are overwritten at the
boundary. Non-contract adapter metadata lives under `extensions`.

## LiteLLM adapter

`MMDLiteLLMProvider` is a thin CustomLLM entry point. It accepts Router model
groups, preserves conversation history, aggregates LiteLLM usage/cost, maps to
LiteLLM exceptions and response objects, and emits final-answer streaming using
LiteLLM-compatible chunks. External calls are mocked in unit tests.

The local `mmd_native_web` implementation is legacy staging functionality and
is explicitly excluded from the first upstream PR. Upstream work should prefer
LiteLLM-native tool facilities; any remaining capability gap requires a
separate proposal.

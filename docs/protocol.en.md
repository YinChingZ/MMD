# Deliberation Protocol v0.1

*[中文](protocol.md)*

This document describes the protocol implemented in `packages/protocol`. It's the as-built version of chapter 5 of `multi-model-deliberation-tech-design.md` and the M0-stage revisions in [multi-model-deliberation-dev-roadmap.md](../multi-model-deliberation-dev-roadmap.md). The current TypeScript CLI imports `@mmd/protocol` directly; the `litellm-integration` branch's Python/Pydantic port must match these schemas and pure-function semantics rather than redefining a separate protocol.

## The six phases

| Phase | Schema file | Description |
|------|-------------|------|
| Propose | `src/schemas/propose.ts` | Each model only sees the user's question, answers independently, and breaks its answer into claims |
| Critique | `src/schemas/critique.ts` | Each model reviews the other models' claims |
| Revise | `src/schemas/revise.ts` | Each model updates its own position based on the critiques it received |
| Normalize | `src/schemas/normalize.ts` | Semantically similar claims are merged into candidate claims |
| Vote | `src/schemas/vote.ts` | Each model votes on the candidate claims |
| Compose | `src/schemas/compose.ts` | The final answer is generated from the consensus classification |

Every phase's input/output is a zod schema. When validation fails, the caller (the current TypeScript CLI, and later the LiteLLM Python port) should retry or ask the model to fix its JSON — not fail the whole run outright (this addresses the "structured output is unreliable" risk from chapter 12 of the tech design doc).

## Protocol-level constraints (M0 hardening — these are hard rules, not implementation suggestions)

### 1. The Normalize phase must stay traceable (addresses risk #2)

`CandidateClaimSchema.source_claim_ids` is required and non-empty (`src/schemas/normalize.ts`). Any surface that renders the final result must be able to trace a candidate claim back to the original, pre-merge claims — because the merging decisions made during Normalize already carry implicit judgment power, and transparent traceability is the only real safeguard. This cannot be simplified away.

### 2. Consensus classification is ratio-based, not a hardcoded model count (addresses risk #3)

`classifyCandidate` in `src/consensus.ts` accepts an arbitrary `expectedVoterCount` and classifies by ratio thresholds:

- `approveRatio >= strongApproveRatio` (default `1.0`) → `strong_consensus`
- any `critical` objection → straight to `disputed`, it cannot be outvoted by a majority
- any `major` objection → routed to `disputed` or `rejected` depending on whether `approveRatio` clears the qualified threshold
- `approveRatio >= qualifiedApproveRatio` (default `0.66`) → `qualified_consensus`
- `approveRatio <= rejectApproveRatio` (default `0.34`) → `rejected`
- everything else → `disputed`

Thresholds can be overridden via `ConsensusThresholds`; defaults live in `DEFAULT_CONSENSUS_THRESHOLDS`. Going from 3 models to 5 or 7 requires no changes to this function (`test/consensus.test.ts` covers multiple model-count scenarios).

**One revision to the vote schema**: the original design had compose rules depend on "critical/major objections," but the vote phase's `BallotSchema` didn't carry severity. We added a required `objection_severity` field for any ballot where `vote === "object"` (`src/schemas/vote.ts`) — without it, `classifyCandidate` can't distinguish `disputed` from `rejected`.

### 3. Claim/candidate ids must be scoped per run (addresses risk #5)

`src/ids.ts` provides `makeRunId()` / `scopedId(runId, localId)` / `parseScopedId(id)`. Any claim/review/vote id persisted to a database should be the result of `scopedId` (`${runId}:${localId}`), not a bare model-generated short id like `a_c1` — otherwise you get primary-key collisions across runs.

### 4. Every phase has a quorum; one model failing shouldn't sink the whole run (addresses risk #4)

`checkQuorum(respondentCount, modelCount, ratio = 2/3)` in `src/quorum.ts` returns:

- `required`: the quorum count needed (default: 2/3 rounded up, at least 1)
- `met`: whether quorum was reached
- `partial`: whether any model failed to respond (flagged even when quorum was met)

Orchestrator rule: if a phase doesn't reach quorum, mark that phase `partial` and explicitly note in the final output that it's "based on only some models' responses." If quorum is met but a model is missing, skip that model's subsequent phases without blocking the rest of the run. A single model timing out or erroring must never fail the entire run.

### 5. Latency/cost budgets and quick mode are concrete protocol paths (addresses risk #1)

`src/budget.ts` defines two paths:

- `STANDARD_BUDGET`: 3 models, 1 round of critique, all six phases, target p50 ≤ 60s / p95 ≤ 120s (baseline numbers pending calibration against real M1 data).
- `QUICK_MODE_BUDGET`: 2 models, `phases` set to `["propose", "normalize", "compose"]` — skips critique/revise/vote; this is a specific path, not a vague "run fewer rounds." Normalize is kept because, without explicit votes, we still need `source_claim_ids` (how many models a candidate covers) to infer consensus strength (each contributing model counts as one implicit approve) — otherwise Compose would have no consensus signal at all.

`getBudget(mode)` returns the matching config; the orchestrator should defer to it for which phases to run, rather than re-deriving that decision itself.

## v0.2: Planning mode (for long-form / comprehensive planning output)

The v0.1 six-phase protocol assumes all claims form one flat, mutually comparable/mergeable set — that works well for narrow, single-question Q&A, but has a structural gap for long-form output like "produce a comprehensive technical plan for a project": claim counts explode (making critique's O(n²) cost unmanageable), claims from unrelated topics get forced into the same merge/vote pool, and Compose's flat output doesn't suit a structured document. v0.2 adds `mode: "planning"`, which splits work by topic and reuses the existing six-phase protocol per topic, rather than redesigning the consensus mechanism itself.

### The Outline phase: why a single coordinator instead of multi-model deliberation

Planning mode adds an **Outline** phase before Propose: a single coordinator call (`buildOutlinePrompt` / `OutlineResultSchema`) splits the question into up to 8 topics (`RunBudget.maxTopics`, also hard-capped at the schema level via `.max(8)` in `OutlineResultSchema`, not just described in the prompt).

Not requiring multi-model participation here — unlike Normalize — is a deliberate choice. Constraint #1 above ("Normalize must stay traceable") targets the risk that dissent gets erased when **already-produced claims carrying truth judgments** are merged. The outline phase produces no claims yet; it only decides how many topics to discuss. A suboptimal topic split is a coverage problem, not a truth/dissent-erasure problem, and it's fully recoverable: every model still proposes independently within each topic during the Propose phase, so if the outline missed something, a model can flag the gap with a `risk`-type claim under the relevant topic. A multi-model outline would cost at least two extra real network round-trips, and real reasoning models typically take 90-250 seconds per phase (see the real-run latency baseline below) — paying that latency for a recoverable, low-risk decision isn't worth it.

### Reusing the six-phase protocol per topic

Each outline topic runs a complete propose→critique→revise→normalize→vote→classify cycle independently (`runTopicDeliberation` in `apps/cli/src/orchestrator.ts`), and all topics run **in parallel** (`Promise.all`/`Promise.allSettled`, not sequentially — to keep latency from scaling linearly with topic count). This means:

- Core functions like `classifyCandidate`, `checkQuorum`, and `fanOutWithQuorum` don't need to know topics exist at all; they're just called once per topic, unchanged.
- Claim/candidate ids are extended in `stampProposal` to `${topicId}::${modelId}::c${i}` (previously `${modelId}::c${i}`), guaranteeing no collisions across topics, without touching `src/ids.ts` (which solves a different problem — storage-key isolation across runs).
- A quorum failure in a single topic causes that topic's `runTopicDeliberation` to throw `DeliberationQuorumError`, but `runPlanningDeliberation` collects results with `Promise.allSettled` — one failed topic doesn't sink the whole planning document (the same "one failed model shouldn't block the run" principle, applied one level up). The whole run only fails if **every** topic fails.

### Section compose: why the executive summary is deterministic concatenation, not a model call

Each topic independently runs a section-compose pass (`buildSectionComposePrompt` / `SectionAnswerSchema`, whose fields are equivalent to `FinalAnswerSchema` plus `topic_id`/`title`/`tldr`). The final document's `executive_summary` is **built in code by concatenating each section's `tldr`** — there's no extra model call to produce a "cross-topic summary." Adding one would turn Compose back into a judge that reasons across topics, exactly the failure mode constraints #1 and #3 above are meant to prevent. `FinalAnswerSchema` itself is unchanged; `SectionAnswerSchema` is a new, independent schema, not a union type that turns `FinalAnswerSchema` into "maybe has a topic, maybe doesn't."

### Budget and CLI

`getBudget("planning")` returns `PLANNING_BUDGET`: full six phases per topic (`phases` matches `STANDARD_BUDGET`), plus `maxTopics: 8`. The CLI triggers this with `--mode planning`.

### Real-run latency baseline (as of this document's last update)

Narrow questions run in `standard` mode with real models (Volcengine/DeepSeek-family reasoning models) took 96-250 seconds end to end — well above the p50 60s / p95 120s targets in `STANDARD_BUDGET`, which were only ever mock-based guesses and haven't been calibrated against real data yet (a known follow-up, out of scope for this v0.2 change). Since planning mode runs the full six phases per topic, a single topic's expected latency is similar to one `standard`-mode run; because topics run in parallel, total latency is roughly bounded by the slowest topic rather than the sum of all topics.

Switching to a genuinely cross-vendor combination (OpenAI GPT-5.5 / DeepSeek v4 Pro / Google Gemini 3.1 Pro, all via OpenRouter) put a single `standard`-mode run at 164-301 seconds — a similar order of magnitude to the same-vendor combination, with no clear slowdown or speedup.

### An observed classification edge case: unanimous critical objections land in `disputed`, not `rejected`

`classifyCandidate`'s rule is "any critical objection routes straight to `disputed`, and can't be outvoted by a majority" (see "consensus classification is ratio-based" above). During real testing, this happened once: Normalize produced a blank/substance-free candidate claim, and all three models voted `object` during Vote (severities: major/critical/critical). Under the current rule, that gets classified as `disputed` rather than the more intuitive `rejected` — because the "critical objection exists" check only looks at presence, not unanimity. This isn't a bug (the rule exists specifically to stop a majority from overriding a lone critical dissent; here it just happened that all three votes were objections), but it's worth recording: if "unanimous rejection displaying as disputed" turns out to confuse users, a special-cased rule could be added later — if every vote is `object` (regardless of severity), classify directly as `rejected`, treated as an explicit unanimous exclusion independent of the ratio thresholds.

### A real disputed case (planning mode, cross-vendor combination)

Running "plan the tech stack for a 3-person e-commerce project" (planning mode) with the cross-vendor combination produced a real disagreement under the "backend stack and API design" topic: the candidate "Java 21 + Spring Boot 3" reached `strong_consensus`, while "TypeScript + Node.js + NestJS" was classified `disputed` — two models voted approve, but the model that had originally proposed that option itself voted `object` (major) during Vote, arguing that presenting the two options as equivalent alternatives was misleading, since an e-commerce project's state machines, transactions, and inventory concurrency are markedly more expensive to handle well in the Node ecosystem. This validated that ratio-based consensus plus the major-objection rule works correctly on a real, substantive technical disagreement (2/3 approve with a major objection wasn't overridden by the majority, and correctly routed to `disputed` instead of `strong_consensus`).

The same re-test also surfaced and fixed a bug: during section-compose, models would invent a more "semantic" new string for `topic_id` (e.g. rewriting the outline's `"4"` into `"backend-tech-stack-api-design"`) instead of echoing back the value they were given — the same class of problem as models inventing their own `model_id`/`claim_id` during propose/critique/revise/vote. `stampSectionAnswer` in `apps/cli/src/orchestrator.ts` now overwrites the model-reported value with the caller-known `topic.topic_id`/`topic.title`, and `MockProvider` in `packages/model-adapters` was updated to deliberately simulate this "id rewriting" behavior so the regression test actually exercises the fix (otherwise the mock would keep dutifully echoing the value back and this class of bug would stay permanently invisible to tests — the second time this project has been bitten by "the mock was too well-behaved to catch a real blind spot").

## Usage

```ts
import {
  ProposalSchema,
  CritiqueSchema,
  RevisionSetSchema,
  NormalizeResultSchema,
  VoteSetSchema,
  FinalAnswerSchema,
  OutlineResultSchema,
  SectionAnswerSchema,
  PlanDocumentSchema,
  classifyCandidate,
  checkQuorum,
  makeRunId,
  scopedId,
  getBudget,
} from "@mmd/protocol";
```

`apps/cli` is this protocol's first consumer (milestone M1). Every model call result in the CLI should pass its corresponding zod schema validation before moving on to the next phase.

## LiteLLM Python Port Status (M2')

The `litellm-integration` branch now has `python/mmd_litellm` as the Python/Pydantic port. It covers quick mode, standard mode, quorum/partial handling, structured repair, run-scoped ids, explicit-vote classification, and the LiteLLM custom provider shell. This document and the TypeScript `packages/protocol` package remain the behavioral baseline; Python tests must continue to match these rules.

The trace return contract is now opt-in and versioned: by default (`return_trace=false`) the response only uses normal OpenAI-compatible `choices[].message.content`; when `return_trace=true`, the LiteLLM Proxy HTTP response includes top-level `mmd` metadata with `mmd.trace_version === 1` and `mmd.protocol === "mmd.v1"`. That trace must preserve candidate/source/vote/classification/quorum/failure auditability without entering the default answer content.

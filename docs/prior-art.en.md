# Related Work and Competitive Analysis (2026-07 Snapshot)

*[中文](prior-art.md)*

This is a dated market and research snapshot derived from the full comparison in [`research/mmd-comparative-landscape-2026-07/`](../research/mmd-comparative-landscape-2026-07/). Stars, releases, and public features change; mechanism classifications and MMD's design risks should be revisited as evidence changes.

## Positioning conclusion

MMD should not claim to be the first multi-model system, to eliminate all single-model power, or to occupy an empty LiteLLM ecosystem. A more accurate position is:

> MMD is an audit-first, claim-level multi-model deliberation workbench. It preserves claim lineage, revisions, and objections, and computes support labels deterministically instead of asking one judge model to declare consensus.

Its differentiation is a claim-level audit data model, deterministic support labels, and real-run failure/cost/trace discipline—not a metaphor of democracy.

## Three comparison layers

### 1. Direct competitors

- **Amiable Dev LLM Council**: independent answers, anonymous review, Borda ranking, a Chairman, dissent, cost controls, failure degradation, and adaptive compute. It is stronger on answer-level ranking, entry points, and bias control; MMD is finer-grained on claim lineage, revision, and objection severity.
- **MALLM**: composable personas, response generators, topologies, and decision protocols with dataset/evaluation support. It is a research-platform benchmark and substantially more ablatable than current MMD.
- **RECONCILE**: heterogeneous models repeatedly inspect and revise answers before confidence-weighted voting. It fits closed-ended reasoning but lacks MMD's general claim lineage.
- **Karpathy LLM Council**: independent answers, anonymous ranking, and a Chairman. The mechanism is short and well known, though the project explicitly disclaims ongoing maintenance.
- **Council Engine**: proposals, constrained critique, and lead resolution that can return recommendation, alternatives, question, or investigate—better than a forced answer when information is insufficient.
- **Star Chamber**: structured sources, clustering, and deterministic consensus/majority/individual buckets for code review, showing that deterministic buckets and provenance are not unique to MMD.
- **OpenRouter Fusion**: panel, structured judge analysis, and an outer-model answer with native search integration. It is a low-friction product path but exposes no MMD-style per-candidate lineage.
- **litesquad**: workers, one critic, revision, a clusterer, and a judge. It is runnable but role-bound and lacks claim-level provenance.
- **rachittshah/llmcouncil**: vote, debate, synthesize, critique, red-team, and MAV protocols, useful as a multi-protocol tool comparison.

### 2. Mechanism baselines

- **LLM-Blender**: PairRanker plus GenFuser.
- **Mixture-of-Agents (MoA)**: layered parallel generation and aggregation.
- **Classic Multi-Agent Debate / Multi-LLM Debate**: tests interaction and conformity/error propagation.
- **ChatEval / Language Model Council**: clarifies the boundary between multi-model evaluation and answer generation.
- **Same-model sampling, majority/approval vote, and simple judge synthesis**: control for the benefit of extra calls or tokens alone.

These are not necessarily product substitutes, but they directly challenge causal claims. If simple sampling plus ranking/fusion matches MMD under the same models and token/dollar budget, a better final score alone cannot establish the necessity of six-stage interaction.

### 3. Adjacent ecosystems

AutoGen, CAMEL, CrewAI, MetaGPT, and AgentVerse are general multi-agent runtimes/frameworks. They support tools, memory, handoffs, workflows, and external side effects. MMD is better understood as a deliberation team pattern that could be embedded in them, not a replacement.

LiteLLM core primarily provides gateway, routing, fallback, cost, and reliability functions. It does not define a complete deliberation protocol natively, but it can host Council/MAD applications; the claim that MMD's ecosystem niche is empty is therefore false.

## Mechanism comparison

| System | Core mechanism | Authoritative decision/output | Claim lineage | Dissent | Primary strength |
|---|---|---|---:|---:|---|
| MMD Standard-C | critique→revision→normalize→claim vote | host classification ledger; coordinator prose | ● | ● | auditability, retained failures, product trace |
| MMD Standard-D | peer Align→host clustering→vote | host ledger; current coordinator prose | ● | ● | tests centralized versus distributed candidate governance |
| Amiable Council | anonymous answer ranking→Chairman | Borda + Chairman | — | ◐ | bias control, CI/API, adaptive compute |
| MALLM | composable topology and decision protocol | configuration-dependent | — | ◐ | academic experimental freedom |
| RECONCILE | repeated revision→confidence-weighted vote | weighted vote | — | — | heterogeneous closed-ended reasoning |
| Fusion | panel→judge analysis→outer answer | judge + outer model | — | ● | hosted search and low friction |
| Star Chamber | finding clustering→deterministic buckets | deterministic buckets | ◐ | ● | actionable domain schema |
| LLM-Blender/MoA | ranking/fusion or layered aggregation | ranker/fuser/aggregator | — | — | strong quality/compute baseline |

## Capabilities that still differentiate MMD

- Candidate `source_claim_ids` are a schema constraint, not merely a transcript.
- Ballots, objection severity, and classifier inputs are auditable.
- Critical/major objections enter deterministic rules instead of being freely interpreted by a composer.
- Trace and product UI share one data model; failed runs retain completed artifacts.
- Planning preserves topic ledgers and uses one GlobalCompose with output-span lineage.

## Shortcomings and counterarguments that must remain visible

- **Normalize is an information bottleneck**: a centralized coordinator can false-merge, false-split, or omit a correct minority claim. Lineage audits only what survived.
- **Compose can still soften a decision**: deterministic labels do not prevent prose from laundering disputed/rejected content. Current Standard-D still has a coordinator presentation call, and its fidelity checker is incomplete.
- **Standard-D is not proven superior**: peer alignment may increase false splits, cost, and abstention. Without MMD's own dual-architecture evidence, distributed governance cannot be claimed generally better.
- **No systematic anonymization or self-vote control**: model/provider identity may bias critique and voting.
- **Limited protocol plugability**: research flexibility is weaker than MALLM.
- **No adaptive depth or consensus calibration evidence**: a support label must not be marketed as factual reliability.
- **No unified public compute-matched benchmark**: quality, cost, latency, and run-to-run variance remain under-evidenced.
- **Unclear license**: the repository currently has no root `LICENSE`; source visibility does not grant rights to use, modify, or redistribute it.

Adding Standard-D does not erase these centralized-coordinator risks. Historical research documents should retain them because they motivate the governance comparison.

## Recommended comparison discipline

1. Compare single, same-model multi-sample, majority, ranking/fusion, anonymous council, and MMD Quick/Standard on the same models, questions, and budget.
2. Report semantic quality, presentation quality, lineage coverage, false merge/split, dissent survival, cost, latency, and partial failure separately.
3. Do not use call count as a proxy for token cost; Align repeats claims and GlobalCompose has a large context.
4. Do not equate consensus labels with correctness; calibrate them using closed-set truth and human evaluation.
5. Report only preregistered conditional pipeline contrasts for Standard-C/D; do not present Normalize and Compose as naturally additive mechanism constants.

External links, access dates, and unverified items are recorded in the research directory's [`sources.md`](../research/mmd-comparative-landscape-2026-07/sources.md).

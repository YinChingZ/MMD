# Prior Art and Competitive Analysis

*[中文](prior-art.md)*

This document records related projects investigated while discussing/promoting MMD in various communities, so the research doesn't need to be redone later, and to ground MMD's differentiation claims in specifics rather than assertion. Researched: 2026-07.

## OpenRouter Fusion Router

- **Mechanism**: a panel of up to 8 models answers in parallel, each with web search/tool access → a judge model reads all panel responses and produces a structured comparative analysis (consensus points, disagreements, coverage gaps, per-model unique insights, blind spots — the judge "doesn't merge them," it doesn't do text merging) → the outer model that received the original request writes the final answer text based on that analysis.
- **Config**: `analysis_models` (the panel, 1-8 models), `model` (the judge's identity), `max_tool_calls`, `temperature` (fixed at 0 for the judge), etc.
- **Cost**: a default 3-model panel costs roughly 4-5x a single completion (N panel calls + 1 judge call + 1 outer synthesis call).
- **Traceability**: only a top-level `model` field and a `router` field in generation metadata — no per-point attribution back to a specific model's claim.
- **Recursion guard**: an `x-openrouter-fusion-depth` header prevents panel/judge models from triggering Fusion recursively.
- **Key differences from MMD**:
  1. Consensus comes from a single judge model's subjective read, not a deterministic function computed over each model's own explicit votes.
  2. No claim-level traceability requirement.
  3. Single round — the panel answers once, with no critique/revise loop where models actually update their positions.
  4. Panel models have built-in web search/tool access, which MMD currently lacks.

## EricThomson/litesquad

- **Mechanism**: worker models (Gemini/Sonnet/DeepSeek/Mistral/Llama) answer independently → a single fixed critic model (Grok) critiques every worker → workers revise based on the critique → a clustering pass (GPT-5) extracts common suggestions → a final judge (Opus) turns the clustered suggestions into "a coherent final answer."
- **Pitch**: "sometimes two or five heads really are better than one."
- **Providers**: Gemini/OpenAI/Anthropic direct; DeepSeek/Mistral/Llama/Grok/Qwen etc. via OpenRouter.
- **Usage**: `litesquad "query"` (deep mode, takes minutes) / `--quick` (bypasses the team) / `--web`.
- **Explicitly stated limitation**: "no agentic tool use, e.g. web calls. Reasoning only"; **no result attribution mechanism — it does not track where a suggestion came from**.
- **Maturity**: 0 stars, 20 commits, Apache-2.0 license — a similarly early-stage prototype, not a mature competitor.
- **Key differences from MMD**:
  1. Roles are bound to specific models (worker/critic/clusterer/judge are each a fixed model), not a symmetric set of arbitrary N models classified by ratio — changing the model count means redesigning the pipeline, unlike MMD's `classifyCandidate`, which is a pure function that naturally supports any model count.
  2. Critique is one fixed critic reviewing every worker one-directionally, not models critiquing each other.
  3. The final answer comes from a single judge model's subjective synthesis, not a deterministic classification over explicit votes.
  4. The docs explicitly acknowledge no traceability mechanism — exactly the problem MMD's schema-enforced, required, non-empty `source_claim_ids` was built to solve.

## Current state of the LiteLLM ecosystem

Searching `BerriAI/litellm`'s open, `enhancement`-labeled issues for keywords (orchestrator / ensemble / consensus / judge / multiple models / best of) turned up **no feature or proposal for "multiple models answer in parallel, then get synthesized/deliberated into one answer."** The two closest hits:

- `#27550`, "Add LLM as orchestrator to choose which LLM to call" — fundamentally single-model routing/fallback: pick one model out of several candidates to call, not synthesizing multiple models' outputs.
- The `llm_as_a_judge` guardrail (related issues: `#30731`, `#27888`, `#27767`) — scores **a single model's single output** for safety/quality to decide whether to allow it through. Not a multi-model consensus mechanism, despite the name inviting confusion.

Conclusion: litellm currently has two layers — "route to which model" and "score a single output" — and nothing resembling "have several models answer, then deliberate them into one conclusion." The capability layer MMD occupies is currently absent from the litellm ecosystem; there's no overlap or duplication of effort.

## Positioning comparison

| Dimension | Fusion Router | litesquad | LiteLLM (current state) | MMD |
|---|---|---|---|---|
| How the final answer is decided | Single judge model's subjective analysis + outer-model synthesis | Single judge model (Opus), subjective synthesis | N/A (single-model routing/scoring) | Deterministic function over explicit votes (ratio thresholds); no model has unilateral authority |
| Per-point traceability | Only a top-level `model` field | Explicitly none | N/A | Schema-required, non-empty `source_claim_ids` |
| Do models critique each other | No (judge reviews the panel one-directionally) | No (one fixed critic reviews workers one-directionally) | N/A | Yes — all models critique each other during Critique, and can revise their own position afterward |
| Is the model count hardcoded | Panel of 1-8; classification logic undisclosed | Roles bound to specific models | N/A | Ratio-based thresholds, works for any N (tested at 3/5/7) |
| Tools/web search | Yes | Explicitly none | Provider-level capability, not this layer | Not currently |
| Single-round vs. multi-round | Single round | Single round (with one revision pass) | N/A | Multi-round (critique→revise→vote), with a single-round `quick` mode available |
| Maturity | Production infrastructure feature | Early prototype (0 stars) | This capability layer doesn't exist yet | Early prototype (M0-v0.2, CLI) |

**Takeaway**: MMD's real difference from Fusion and litesquad isn't "having multiple models involved" — both of those already do. It's two specific things: **whether any single model is granted authority over the consensus outcome** (MMD hands that to a deterministic function over explicit votes; both Fusion and litesquad hand it to one judge model's subjective read), and **whether traceability is a protocol-level, enforced constraint** (MMD, yes; neither of the others, as far as documented). In the litellm ecosystem, this entire capability layer doesn't currently exist.

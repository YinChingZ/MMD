# RFC: multi-call MMD meta-provider for LiteLLM

## Decision requested

Should a multi-call virtual model such as MMD integrate as a CustomLLM/provider,
or should LiteLLM expose a Router/strategy extension point for orchestration
that calls multiple configured model groups?

No core placement is assumed before maintainers answer this question.

## Motivation

MMD runs bounded, auditable multi-model deliberation while relying on LiteLLM
for all ordinary model access. A request to `mmd/fusion` fans out to configured
model groups, produces deterministic candidate/classification ledgers, and
returns one OpenAI-compatible answer plus optional `mmd.trace.v3` metadata.

## Proposed request

```json
{
  "model": "mmd/fusion",
  "messages": [{"role": "user", "content": "..."}],
  "analysis_models": ["group-a", "group-b"],
  "coordinator_model": "group-a",
  "mmd_mode": "quick",
  "governance": "centralized",
  "return_trace": false
}
```

Quick requires exactly two distinct models. Standard-C supports larger panels.
Standard-D and its thresholds are experimental and require a versioned manifest.
Planning uses one final GlobalCompose over topic ledgers.

## Call graph and ownership

```text
client
  -> LiteLLM Proxy/SDK
    -> MMD orchestration entry point
      -> LiteLLM Router: panel calls
      -> deterministic protocol core
      -> LiteLLM Router: coordinator call
    -> native LiteLLM ModelResponse / stream / exception
```

MMD does not read deployment secrets or reimplement routing, provider adapters,
cost maps, callback dispatch, or fallback policy. Nested calls carry recursion
metadata and may not select the MMD alias itself.

## Trace and safety boundary

The optional trace is a versioned snake_case envelope containing immutable
artifacts, host-generated IDs, ballots, classifications, call/usage ledgers,
partial failures, and output lineage. Prompts and credentials are not required
in logs. Non-contract implementation information is isolated in `extensions`.

All external calls in tests are mocked. Request limits include model-call
budget, per-call/run timeout, coordinator retry count, panel quorum, and context
capacity checks. The local experimental `web_fetch` implementation is outside
the initial proposal.

## Reviewable contribution slices

The proposed sequence is deterministic types/algorithms first, then
Quick/Standard-C Router orchestration, then Proxy/stream/error/usage integration,
followed by experimental Standard-D and Planning in separate PRs. Each slice is
usable and testable without accepting the later ones.

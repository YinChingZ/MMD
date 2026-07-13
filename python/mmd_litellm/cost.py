from __future__ import annotations

from pydantic import BaseModel

from .client import TokenUsage


class CostEstimate(BaseModel):
    cost_usd: float | None = None
    cost_unavailable: bool = False
    reason: str | None = None


def estimate_call_cost(
    model: str,
    usage: TokenUsage | None,
    *,
    precomputed_cost_usd: float | None = None,
) -> CostEstimate:
    """Estimate USD cost for one model call via LiteLLM's own pricing map.

    If `precomputed_cost_usd` is given (LiteLLM already priced this exact call -
    see `client.py::_extract_cost`), it's used as-is with no further computation:
    that number came from the same pricing map this function would otherwise call
    into, so recomputing it would be redundant and risks diverging from whatever
    LiteLLM actually charged (custom pricing overrides, region-specific rates).

    Otherwise falls back to calling `litellm.cost_per_token` directly - needed for
    any `CompletionClient` that isn't `LiteLLMCompletionClient` (e.g. this
    codebase's own test doubles), which have no LiteLLM response to read a
    precomputed cost from.

    Never raises. Degrades to `cost_unavailable=True` for every failure mode:
    no usage to price from, litellm not installed, or litellm has no pricing
    entry for `model` (e.g. every fake test model id in this codebase's own
    fixtures, or any self-hosted/custom model litellm doesn't recognize).
    MMD deliberately does not maintain its own price table - see
    docs/development.md's "暂不进入主线的工作" section.
    """
    if precomputed_cost_usd is not None:
        return CostEstimate(cost_usd=precomputed_cost_usd)
    if usage is None:
        return CostEstimate(
            cost_unavailable=True,
            reason="no token usage reported for this call",
        )
    try:
        import litellm
    except ImportError:
        return CostEstimate(
            cost_unavailable=True,
            reason="litellm is not installed; install mmd-litellm[litellm] to enable cost estimation",
        )

    litellm.suppress_debug_info = True
    try:
        prompt_cost, completion_cost = litellm.cost_per_token(
            model=model,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
        )
    except Exception as error:
        return CostEstimate(
            cost_unavailable=True,
            reason=f"litellm could not price model {model!r}: {error}",
        )
    return CostEstimate(cost_usd=prompt_cost + completion_cost)

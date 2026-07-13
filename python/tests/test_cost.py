import importlib.util

import pytest

from mmd_litellm.client import TokenUsage
from mmd_litellm.cost import estimate_call_cost


def test_estimate_call_cost_uses_precomputed_cost_without_touching_litellm():
    # A model id litellm could never price, to prove the precomputed value short-
    # circuits litellm.cost_per_token entirely rather than being overridden by it.
    result = estimate_call_cost(
        "totally-unpriceable-model",
        TokenUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15),
        precomputed_cost_usd=0.00042,
    )
    assert result.cost_unavailable is False
    assert result.cost_usd == 0.00042


def test_estimate_call_cost_unavailable_when_usage_is_none():
    result = estimate_call_cost("gpt-4o-mini", None)
    assert result.cost_unavailable is True
    assert result.cost_usd is None
    assert "usage" in result.reason


def test_estimate_call_cost_unavailable_when_litellm_not_installed(monkeypatch):
    monkeypatch.setitem(__import__("sys").modules, "litellm", None)
    result = estimate_call_cost(
        "gpt-4o-mini",
        TokenUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15),
    )
    assert result.cost_unavailable is True
    assert result.cost_usd is None
    assert "not installed" in result.reason


@pytest.mark.skipif(
    importlib.util.find_spec("litellm") is None,
    reason="LiteLLM is an optional runtime dependency",
)
def test_estimate_call_cost_unavailable_for_unmapped_model():
    result = estimate_call_cost(
        "model_a",
        TokenUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15),
    )
    assert result.cost_unavailable is True
    assert result.cost_usd is None
    assert "model_a" in result.reason


@pytest.mark.skipif(
    importlib.util.find_spec("litellm") is None,
    reason="LiteLLM is an optional runtime dependency",
)
def test_estimate_call_cost_computes_cost_for_known_model():
    result = estimate_call_cost(
        "gpt-4o-mini",
        TokenUsage(prompt_tokens=1000, completion_tokens=200, total_tokens=1200),
    )
    assert result.cost_unavailable is False
    assert result.cost_usd is not None
    assert result.cost_usd > 0

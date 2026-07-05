import asyncio

import pytest

from mmd_litellm.litellm_provider import MMDLiteLLMProvider
from tests.test_orchestrator import ScriptedClient


def _content(response):
    return response["choices"][0]["message"]["content"]


def test_provider_returns_openai_compatible_response_with_trace():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "return_trace": True,
            },
        )
    )

    assert response["object"] == "chat.completion"
    assert response["model"] == "mmd/fusion"
    assert _content(response) == "Use a small TypeScript monorepo for this project."
    assert response["mmd"]["trace_version"] == 1
    assert response["mmd"]["protocol"] == "mmd.v1"
    assert response["mmd"]["mode"] == "quick"
    assert response["mmd"]["quorum"]["propose"]["met"] is True


def test_provider_supports_standard_mode():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "mmd_mode": "standard",
                "return_trace": True,
            },
        )
    )

    assert _content(response) == "Use a small TypeScript monorepo for this project."
    assert response["mmd"]["trace_version"] == 1
    assert response["mmd"]["mode"] == "standard"
    assert len(response["mmd"]["votes"]) == 2


def test_provider_supports_planning_mode_with_plan_content():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "Plan the next milestone."}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "mmd_mode": "planning",
                "return_trace": True,
            },
        )
    )

    assert "# Plan Document:" in _content(response)
    assert "## Executive Summary" in _content(response)
    assert "## Backend" in _content(response)
    assert response["mmd"]["mode"] == "planning"
    assert response["mmd"]["plan_document"]["sections"][0]["topic_id"] == "backend"


def test_provider_requires_analysis_models():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    with pytest.raises(ValueError):
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
            )
        )


def test_provider_rejects_recursive_invocation():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    with pytest.raises(ValueError):
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                    "mmd_deliberation_depth": 1,
                },
            )
        )

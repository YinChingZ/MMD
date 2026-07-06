import asyncio

import pytest

from mmd_litellm.client import TokenUsage
from mmd_litellm.litellm_provider import MMDLiteLLMProvider
from mmd_litellm.prompts import CompletionRequest
from tests.test_orchestrator import ScriptedClient, UsageScriptedClient


def _content(response):
    return response["choices"][0]["message"]["content"]


class FakeRouter:
    def __init__(self) -> None:
        self.scripted = ScriptedClient()
        self.calls = []

    async def acompletion(self, **kwargs):
        self.calls.append(kwargs)
        metadata = dict(kwargs["metadata"])
        request = CompletionRequest(
            system_prompt=kwargs["messages"][0]["content"],
            user_prompt=kwargs["messages"][1]["content"],
            meta={
                key: value
                for key, value in metadata.items()
                if key != "mmd_deliberation_depth"
            },
        )
        text = await self.scripted.acomplete(
            kwargs["model"], request, timeout=kwargs.get("timeout")
        )
        return {
            "choices": [{"message": {"content": text}}],
            "usage": {
                "prompt_tokens": 1,
                "completion_tokens": 2,
                "total_tokens": 3,
            },
        }


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
    assert response["mmd"]["usage"]["usage_unavailable"] is True


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


def test_provider_response_usage_uses_aggregated_usage_without_trace():
    provider = MMDLiteLLMProvider(client=UsageScriptedClient())
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "return_trace": False,
            },
        )
    )

    assert "mmd" not in response
    assert response["usage"] == {
        "prompt_tokens": 4,
        "completion_tokens": 8,
        "total_tokens": 12,
    }


def test_provider_uses_router_when_client_is_not_injected():
    router = FakeRouter()
    provider = MMDLiteLLMProvider(router=router)
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["router/model-a", "router/model-b"],
                "coordinator_model": "router/coordinator",
                "return_trace": True,
            },
        )
    )

    assert _content(response) == "Use a small TypeScript monorepo for this project."
    assert response["usage"] == {
        "prompt_tokens": 4,
        "completion_tokens": 8,
        "total_tokens": 12,
    }
    assert [call["model"] for call in router.calls] == [
        "router/model-a",
        "router/model-b",
        "router/coordinator",
        "router/coordinator",
    ]
    assert all(call["metadata"]["mmd_deliberation_depth"] == 1 for call in router.calls)
    assert [call["metadata"]["phase"] for call in router.calls] == [
        "propose",
        "propose",
        "normalize",
        "compose",
    ]


def test_provider_prefers_explicit_client_over_router():
    router = FakeRouter()
    provider = MMDLiteLLMProvider(
        client=UsageScriptedClient(
            usage=TokenUsage(prompt_tokens=2, completion_tokens=3, total_tokens=5)
        ),
        router=router,
    )
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
            },
        )
    )

    assert response["usage"] == {
        "prompt_tokens": 8,
        "completion_tokens": 12,
        "total_tokens": 20,
    }
    assert router.calls == []


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

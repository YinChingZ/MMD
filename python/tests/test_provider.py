import asyncio
import importlib.util

import pytest

from mmd_litellm import tools as tools_module
from mmd_litellm.client import TokenUsage
from mmd_litellm.errors import (
    MMDProviderAPIError,
    MMDProviderBadRequestError,
    MMDProviderBudgetError,
    MMDProviderQuorumError,
    MMDProviderTimeoutError,
    MMDProviderToolBudgetError,
)
from mmd_litellm.litellm_provider import MMDLiteLLMProvider
from mmd_litellm.prompts import CompletionRequest
from tests.test_orchestrator import (
    ScriptedClient,
    SlowScriptedClient,
    ToolLoopScriptedClient,
    UsageScriptedClient,
)


def _content(response):
    return response["choices"][0]["message"]["content"]


class FakeRouter:
    def __init__(self, model_names: list[str] | None = None) -> None:
        self.scripted = ScriptedClient()
        self.calls = []
        self._model_names = (
            ["router/model-a", "router/model-b", "router/coordinator"]
            if model_names is None
            else model_names
        )

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

    def get_model_names(self, team_id=None):
        return list(self._model_names)


class RecordingTraceLogger:
    def __init__(self) -> None:
        self.events = []

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        self.events.append(
            {
                "kwargs": kwargs,
                "response_obj": response_obj,
                "start_time": start_time,
                "end_time": end_time,
            }
        )


class FakeLiteLLMLogging:
    def __init__(self) -> None:
        self.model_call_details = {}


def test_package_exports_stable_litellm_provider_entrypoint():
    from mmd_litellm import MMDLiteLLMProvider as exported_provider
    from mmd_litellm import mmd_custom_llm

    assert exported_provider is MMDLiteLLMProvider
    assert isinstance(mmd_custom_llm, MMDLiteLLMProvider)


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
    assert "mmd_analysis" not in response
    assert response["usage"] == {
        "prompt_tokens": 4,
        "completion_tokens": 8,
        "total_tokens": 12,
    }


def test_provider_return_analysis_without_full_trace():
    provider = MMDLiteLLMProvider(client=UsageScriptedClient())
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "return_analysis": True,
                "return_trace": False,
            },
        )
    )

    assert "mmd" not in response
    analysis = response["mmd_analysis"]
    assert analysis["analysis_version"] == 1
    assert analysis["protocol"] == "mmd.analysis.v1"
    assert analysis["mode"] == "quick"
    assert analysis["consensus_summary"]["strong"] == [
        "Use a small TypeScript monorepo for this project."
    ]
    assert analysis["disagreements"] == []
    assert analysis["model_coverage"][0]["candidate_id"] == "candidate_1"
    assert analysis["model_coverage"][0]["source_model_count"] == 2
    assert analysis["model_coverage"][0]["source_model_ids"] == [
        "model_a",
        "model_b",
    ]
    assert analysis["notable_unique_points"] == []
    assert analysis["performance"]["panel"]["call_count"] == 2
    assert analysis["performance"]["panel"]["cost_unavailable"] is True
    assert analysis["limitations"] == [
        "This analysis is derived deterministically from MMD consensus data; it is not a separate factual verification step.",
        "Cost estimates were unavailable for some model calls (litellm not installed or the model is not in litellm's pricing map).",
    ]


def test_provider_return_analysis_can_coexist_with_trace():
    provider = MMDLiteLLMProvider(client=UsageScriptedClient())
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "return_analysis": True,
                "return_trace": True,
            },
        )
    )

    assert response["mmd"]["trace_version"] == 1
    assert response["mmd_analysis"]["analysis_version"] == 1
    assert response["mmd"]["run_id"] == response["mmd_analysis"]["run_id"]


@pytest.mark.skipif(
    importlib.util.find_spec("litellm") is None,
    reason="LiteLLM is an optional runtime dependency",
)
def test_provider_errors_preserve_litellm_native_types():
    from litellm.exceptions import APIError, BadRequestError

    provider = MMDLiteLLMProvider(client=ScriptedClient())

    with pytest.raises(MMDProviderBadRequestError) as invalid_request:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "assistant", "content": "No user prompt."}],
                optional_params={"analysis_models": ["model_a", "model_b"]},
            )
        )
    assert isinstance(invalid_request.value, BadRequestError)
    assert invalid_request.value.llm_provider == "mmd"
    assert invalid_request.value.model == "mmd/fusion"
    assert invalid_request.value.error_payload()["mmd"]["cause"] == "ValueError"

    runtime_provider = MMDLiteLLMProvider(
        client=UsageScriptedClient(invalid_json_once={("normalize", "model_a")})
    )
    with pytest.raises(MMDProviderAPIError) as runtime_failure:
        asyncio.run(
            runtime_provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                    "max_repair_attempts": 0,
                },
            )
        )
    assert isinstance(runtime_failure.value, APIError)
    assert runtime_failure.value.llm_provider == "mmd"
    assert runtime_failure.value.model == "mmd/fusion"


def test_provider_trace_logging_is_opt_in():
    logger = RecordingTraceLogger()
    provider = MMDLiteLLMProvider(
        client=UsageScriptedClient(),
        trace_logger=logger,
    )
    asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
            },
        )
    )

    assert logger.events == []


def test_provider_emits_trace_logging_without_returning_full_trace():
    logger = RecordingTraceLogger()
    provider = MMDLiteLLMProvider(
        client=UsageScriptedClient(),
        trace_logger=logger,
    )
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "mmd_log_trace": True,
                "return_trace": False,
            },
        )
    )

    assert "mmd" not in response
    assert len(logger.events) == 1
    event = logger.events[0]
    payload = event["kwargs"]["metadata"]["mmd"]
    assert payload["trace_version"] == 1
    assert payload["protocol"] == "mmd.v1"
    assert payload["mode"] == "quick"
    assert payload["run_id"]
    assert payload["quorum"]["propose"]["met"] is True
    assert "candidate_1" in payload["classifications"]
    assert payload["candidate_claims"][0]["candidate_id"] == "candidate_1"
    assert "propose" in payload["failures"]
    assert payload["usage"]["total_tokens"] == 12
    assert event["kwargs"]["mmd"] == payload


def test_provider_caps_candidates_in_logging_trace_only():
    logger = RecordingTraceLogger()
    provider = MMDLiteLLMProvider(
        client=UsageScriptedClient(),
        trace_logger=logger,
    )
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "mmd_log_trace": True,
                "max_log_trace_candidates": 0,
                "return_trace": True,
            },
        )
    )

    logged_payload = logger.events[0]["kwargs"]["mmd"]
    assert logged_payload["candidate_claims"] == []
    assert logged_payload["truncation"] == {
        "candidate_claims_omitted": 1,
        "topic_candidate_claims_omitted": 0,
    }
    assert response["mmd"]["normalize"]["candidate_claims"][0][
        "candidate_id"
    ] == "candidate_1"


def test_provider_trace_logging_status_is_in_returned_trace_when_enabled():
    logger = RecordingTraceLogger()
    provider = MMDLiteLLMProvider(
        client=UsageScriptedClient(),
        trace_logger=logger,
    )
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "mmd_log_trace": True,
                "return_trace": True,
            },
        )
    )

    assert response["mmd"]["trace_logging"] == {
        "attempted": True,
        "delivered": 1,
        "failures": [],
    }
    assert len(logger.events) == 1


def test_provider_attaches_trace_to_litellm_request_logging_context():
    logging_obj = FakeLiteLLMLogging()
    provider = MMDLiteLLMProvider(client=UsageScriptedClient())

    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            logging_obj=logging_obj,
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "mmd_log_trace": True,
                "return_trace": True,
            },
        )
    )

    assert logging_obj.model_call_details["mmd"]["trace_version"] == 1
    assert logging_obj.model_call_details["mmd"]["run_id"] == response["mmd"]["run_id"]
    assert response["mmd"]["trace_logging"] == {
        "attempted": True,
        "delivered": 0,
        "failures": [],
        "attached_to_litellm_logging": True,
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


def test_provider_forwards_advanced_config_to_router_calls():
    router = FakeRouter()
    provider = MMDLiteLLMProvider(router=router)
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": [
                    "router/model-a",
                    "router/model-b",
                    "router/model-c",
                ],
                "coordinator_model": "router/coordinator",
                "preset": "cheap",
                "max_completion_tokens": 321,
                "temperature": 0.8,
                "reasoning": {"effort": "low"},
                "model_params": {"extra_body": {"route": "mmd"}},
                "analysis_model_params": {"top_p": 0.9},
                "coordinator_model_params": {"top_p": 0.2},
            },
        )
    )

    assert _content(response) == "Use a small TypeScript monorepo for this project."
    assert [call["model"] for call in router.calls] == [
        "router/model-a",
        "router/model-b",
        "router/coordinator",
        "router/coordinator",
    ]
    assert all(call["timeout"] == 30.0 for call in router.calls)
    for call in router.calls[:2]:
        assert call["temperature"] == 0.8
        assert call["top_p"] == 0.9
        assert call["max_completion_tokens"] == 321
        assert call["reasoning"] == {"effort": "low"}
        assert call["extra_body"] == {"route": "mmd"}
    for call in router.calls[2:]:
        assert call["temperature"] == 0.1
        assert call["top_p"] == 0.2
        assert call["max_completion_tokens"] == 321
        assert call["reasoning"] == {"effort": "low"}
        assert call["extra_body"] == {"route": "mmd"}


def test_provider_forwards_tools_to_panel_and_trace_only_marks_availability():
    tool = {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Provider-managed web search.",
            "parameters": {"type": "object", "properties": {}},
        },
    }
    router = FakeRouter()
    provider = MMDLiteLLMProvider(router=router)
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            tools=[tool],
            tool_choice="auto",
            optional_params={
                "analysis_models": ["router/model-a", "router/model-b"],
                "coordinator_model": "router/coordinator",
                "max_tool_calls": 2,
                "tool_mode": "experimental_passthrough",
                "return_trace": True,
            },
        )
    )

    for call in router.calls[:2]:
        assert call["tools"] == [tool]
        assert call["tool_choice"] == "auto"
        assert call["max_tool_calls"] == 2
    for call in router.calls[2:]:
        assert "tools" not in call
        assert "tool_choice" not in call
        assert "max_tool_calls" not in call
    assert response["mmd"]["tooling"] == {
        "enabled_for_panel": True,
        "enabled_for_coordinator": False,
        "tool_count": 1,
        "tool_choice": "auto",
        "max_tool_calls": 2,
        "tool_mode": "experimental_passthrough",
        "experimental": True,
        "tool_calls_executed": 0,
        "tool_calls_failed": 0,
        "tool_call_events": [],
    }


def test_provider_forwards_function_name_tool_choice_object():
    tool = {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Provider-managed web search.",
            "parameters": {"type": "object", "properties": {}},
        },
    }
    tool_choice = {"type": "function", "function": {"name": "web_search"}}
    router = FakeRouter()
    provider = MMDLiteLLMProvider(router=router)
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            tools=[tool],
            tool_choice=tool_choice,
            optional_params={
                "analysis_models": ["router/model-a", "router/model-b"],
                "coordinator_model": "router/coordinator",
                "tool_mode": "experimental_passthrough",
                "return_trace": True,
            },
        )
    )

    for call in router.calls[:2]:
        assert call["tool_choice"] == tool_choice
    assert response["mmd"]["tooling"]["tool_choice"] == tool_choice


def test_provider_forwards_parallel_tool_calls_under_experimental_passthrough():
    tool = {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Provider-managed web search.",
            "parameters": {"type": "object", "properties": {}},
        },
    }
    router = FakeRouter()
    provider = MMDLiteLLMProvider(router=router)
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            tools=[tool],
            tool_choice="auto",
            parallel_tool_calls=False,
            optional_params={
                "analysis_models": ["router/model-a", "router/model-b"],
                "coordinator_model": "router/coordinator",
                "tool_mode": "experimental_passthrough",
                "return_trace": True,
            },
        )
    )

    for call in router.calls[:2]:
        assert call["parallel_tool_calls"] is False
    for call in router.calls[2:]:
        assert "parallel_tool_calls" not in call
    assert response["mmd"]["tooling"]["parallel_tool_calls"] is False


def test_provider_can_forward_tools_to_coordinator_when_enabled():
    tool = {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Provider-managed web search.",
            "parameters": {"type": "object", "properties": {}},
        },
    }
    router = FakeRouter()
    provider = MMDLiteLLMProvider(router=router)
    asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["router/model-a", "router/model-b"],
                "coordinator_model": "router/coordinator",
                "tools": [tool],
                "coordinator_tools_enabled": True,
                "tool_mode": "experimental_passthrough",
            },
        )
    )

    assert all(call["tools"] == [tool] for call in router.calls)


def test_provider_rejects_tools_by_default():
    tool = {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Provider-managed web search.",
            "parameters": {"type": "object", "properties": {}},
        },
    }
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    with pytest.raises(MMDProviderBadRequestError) as excinfo:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                tools=[tool],
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                },
            )
        )
    assert excinfo.value.status_code == 400
    assert "tool_mode" in str(excinfo.value)


def test_provider_rejects_tool_choice_only_without_tools_by_default():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    with pytest.raises(MMDProviderBadRequestError) as excinfo:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                tool_choice="auto",
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                },
            )
        )
    assert excinfo.value.status_code == 400


def test_provider_rejects_response_format():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    with pytest.raises(MMDProviderBadRequestError) as excinfo:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                response_format={"type": "json_object"},
                optional_params={"analysis_models": ["model_a", "model_b"]},
            )
        )
    assert excinfo.value.status_code == 400
    assert "response_format" in str(excinfo.value)


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


def test_provider_return_analysis_supports_planning_topics():
    provider = MMDLiteLLMProvider(client=UsageScriptedClient())
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "Plan the next milestone."}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "mmd_mode": "planning",
                "return_analysis": True,
            },
        )
    )

    analysis = response["mmd_analysis"]
    assert analysis["mode"] == "planning"
    assert "mmd" not in response
    assert analysis["consensus_summary"]["strong"][0].startswith("Backend:")
    assert [topic["topic_id"] for topic in analysis["topics"]] == [
        "backend",
        "deployment",
    ]
    assert analysis["topics"][0]["model_coverage"][0]["source_model_count"] == 2
    assert analysis["performance"] is not None
    assert analysis["performance"]["panel"]["call_count"] == 16
    assert analysis["performance"]["coordinator"]["call_count"] == 5


def test_provider_requires_analysis_models():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    with pytest.raises(MMDProviderBadRequestError) as exc_info:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
            )
        )

    error = exc_info.value
    assert error.status_code == 400
    assert error.error_payload()["type"] == "bad_request_error"
    assert error.error_payload()["model"] == "mmd/fusion"


def test_provider_discovers_default_panel_from_router_when_analysis_models_omitted():
    router = FakeRouter(model_names=["router/model-a", "router/model-b", "mmd-fusion"])
    provider = MMDLiteLLMProvider(router=router)
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={"return_trace": True},
        )
    )

    assert _content(response) == "Use a small TypeScript monorepo for this project."
    assert [call["model"] for call in router.calls][:2] == [
        "router/model-a",
        "router/model-b",
    ]
    # "mmd-fusion" (an mmd-alias entry LiteLLM's own model_list happens to also
    # expose) must never be selected into the discovered panel.
    assert "mmd-fusion" not in [call["model"] for call in router.calls]


def test_provider_default_panel_excludes_public_model_alias_even_when_not_mmd_pattern():
    # Regression for operator aliases like "my-mmd-panel" that don't match
    # "mmd-fusion"/"mmd/*" but are still this MMD deployment's own model_name.
    router = FakeRouter(model_names=["router/model-a", "router/model-b", "my-mmd-panel"])
    provider = MMDLiteLLMProvider(router=router)
    response = asyncio.run(
        provider.acompletion(
            model="my-mmd-panel",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={"return_trace": True},
        )
    )

    assert [call["model"] for call in router.calls][:2] == [
        "router/model-a",
        "router/model-b",
    ]
    assert "my-mmd-panel" not in [call["model"] for call in router.calls]


def test_provider_default_panel_discovery_empty_after_filtering_raises_bad_request():
    router = FakeRouter(model_names=["mmd-fusion"])
    provider = MMDLiteLLMProvider(router=router)
    with pytest.raises(MMDProviderBadRequestError) as exc_info:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
            )
        )

    assert exc_info.value.status_code == 400
    assert "could not discover a default panel" in str(exc_info.value)
    assert router.calls == []


def test_provider_no_default_panel_without_router_or_client():
    # No client, no router injected -> LiteLLMCompletionClient(router=None) ->
    # discover_model_groups() returns None -> falls through to today's plain
    # required-field error, not the new "could not discover" message.
    provider = MMDLiteLLMProvider()
    with pytest.raises(MMDProviderBadRequestError) as exc_info:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
            )
        )

    assert exc_info.value.status_code == 400
    assert "could not discover a default panel" not in str(exc_info.value)


def test_provider_rejects_recursive_invocation():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    with pytest.raises(MMDProviderBadRequestError) as exc_info:
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

    assert exc_info.value.status_code == 400
    assert "recursive MMD invocation is not allowed" in str(exc_info.value)


def test_provider_maps_quorum_failure_to_provider_api_error():
    provider = MMDLiteLLMProvider(
        client=ScriptedClient(fail_models={"model_b", "model_c"})
    )
    with pytest.raises(MMDProviderQuorumError) as exc_info:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                optional_params={
                    "analysis_models": ["model_a", "model_b", "model_c"],
                },
            )
        )

    error = exc_info.value
    payload = error.error_payload()
    assert error.status_code == 500
    assert payload["code"] == "mmd_quorum_not_met"
    assert payload["mmd"]["phase"] == "propose"
    assert payload["mmd"]["quorum"]["respondent_count"] == 1
    assert payload["mmd"]["quorum"]["required"] == 2
    assert [failure["model_id"] for failure in payload["mmd"]["failures"]] == [
        "model_b",
        "model_c",
    ]


def test_provider_maps_total_timeout_to_gateway_timeout_error():
    provider = MMDLiteLLMProvider(client=SlowScriptedClient())

    with pytest.raises(MMDProviderTimeoutError) as exc_info:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                    "max_run_timeout": 0.01,
                },
            )
        )

    error = exc_info.value
    assert error.status_code == 504
    assert error.error_payload()["code"] == "mmd_run_timeout"
    assert error.error_payload()["mmd"] == {"max_run_timeout": 0.01}


def test_provider_maps_call_budget_to_rate_limit_error():
    provider = MMDLiteLLMProvider(client=ScriptedClient())

    with pytest.raises(MMDProviderBudgetError) as exc_info:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                    "max_total_calls": 1,
                },
            )
        )

    error = exc_info.value
    assert error.status_code == 429
    assert error.error_payload()["code"] == "mmd_call_budget_exceeded"
    assert error.error_payload()["mmd"] == {"max_total_calls": 1}


def test_provider_maps_structured_output_failure_to_api_error():
    provider = MMDLiteLLMProvider(
        client=UsageScriptedClient(invalid_json_once={("normalize", "model_a")})
    )
    with pytest.raises(MMDProviderAPIError) as exc_info:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                    "max_repair_attempts": 0,
                },
            )
        )

    error = exc_info.value
    assert error.status_code == 500
    assert error.error_payload()["code"] == "mmd_api_error"
    assert error.error_payload()["mmd"]["cause"] == "ValueError"


def test_provider_preserves_system_message_and_history_in_deliberation_context():
    router = FakeRouter()
    provider = MMDLiteLLMProvider(router=router)
    asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[
                {"role": "system", "content": "Be concise."},
                {"role": "user", "content": "What should we build next?"},
                {"role": "assistant", "content": "Let me check a tool."},
                {
                    "role": "tool",
                    "tool_call_id": "call_1",
                    "content": "search results: monorepo pros/cons",
                },
                {"role": "user", "content": "Given that, what do you recommend?"},
            ],
            optional_params={
                "analysis_models": ["router/model-a", "router/model-b"],
                "coordinator_model": "router/coordinator",
            },
        )
    )

    propose_prompt = router.calls[0]["messages"][1]["content"]
    assert "Conversation context so far:" in propose_prompt
    assert "Be concise." in propose_prompt
    assert "What should we build next?" in propose_prompt
    assert "Let me check a tool." in propose_prompt
    assert "search results: monorepo pros/cons" in propose_prompt
    assert "Question: Given that, what do you recommend?" in propose_prompt


def test_provider_rejects_unsupported_multimodal_content_part():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    with pytest.raises(MMDProviderBadRequestError) as excinfo:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": "http://x"}}
                        ],
                    }
                ],
                optional_params={"analysis_models": ["model_a", "model_b"]},
            )
        )
    assert excinfo.value.status_code == 400
    assert "image_url" in str(excinfo.value)


class _FakeMessage:
    def __init__(self) -> None:
        self.content = None
        self.role = "assistant"


class _FakeChoice:
    def __init__(self) -> None:
        self.message = _FakeMessage()
        self.finish_reason = "stop"


class _FakeModelResponse:
    def __init__(self) -> None:
        self.id = None
        self.created = None
        self.model = None
        self.object = None
        self.usage = None
        self.choices = [_FakeChoice()]


def test_provider_populates_supplied_model_response_object_in_place():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    fake = _FakeModelResponse()
    result = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            model_response=fake,
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "return_trace": True,
            },
        )
    )

    assert result is fake
    assert fake.model == "mmd/fusion"
    assert fake.choices[0].message.content == (
        "Use a small TypeScript monorepo for this project."
    )
    assert fake.choices[0].finish_reason == "stop"
    assert fake.mmd["trace_version"] == 1


@pytest.mark.skipif(
    importlib.util.find_spec("litellm") is None,
    reason="LiteLLM is an optional runtime dependency",
)
def test_provider_populates_real_litellm_model_response_when_absent():
    import litellm
    from litellm.types.utils import ModelResponse

    provider = MMDLiteLLMProvider(client=ScriptedClient())
    result = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={"analysis_models": ["model_a", "model_b"]},
        )
    )

    assert isinstance(result, ModelResponse)
    assert result.choices[0].message.content == (
        "Use a small TypeScript monorepo for this project."
    )
    assert result.model == "mmd/fusion"


def test_provider_rejects_invalid_deliberation_policy():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    with pytest.raises(MMDProviderBadRequestError) as exc_info:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                    "deliberation_policy": "sometimes",
                },
            )
        )
    assert exc_info.value.status_code == 400


def test_provider_deliberation_policy_off_returns_single_model_response_without_fanout():
    router = FakeRouter()
    provider = MMDLiteLLMProvider(router=router)
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "deliberation_policy": "off",
                "return_trace": True,
            },
        )
    )

    assert len(router.calls) == 1
    assert _content(response) == "model_a direct answer: What should we build next?"
    assert response["mmd"]["policy"]["policy"] == "off"
    assert response["mmd"]["policy"]["deliberated"] is False


def test_provider_deliberation_policy_off_still_forwards_conversation_context():
    router = FakeRouter()
    provider = MMDLiteLLMProvider(router=router)
    asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[
                {"role": "system", "content": "Be concise."},
                {"role": "user", "content": "What should we build next?"},
                {"role": "assistant", "content": "Let's discuss."},
                {"role": "user", "content": "Given that, what do you recommend?"},
            ],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "deliberation_policy": "off",
            },
        )
    )

    assert len(router.calls) == 1
    direct_prompt = router.calls[0]["messages"][1]["content"]
    assert "Conversation context so far:" in direct_prompt
    assert "Be concise." in direct_prompt
    assert "Question: Given that, what do you recommend?" in direct_prompt


def test_provider_deliberation_policy_off_still_rejects_tools_by_default():
    tool = {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Provider-managed web search.",
            "parameters": {"type": "object", "properties": {}},
        },
    }
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    with pytest.raises(MMDProviderBadRequestError) as excinfo:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                tools=[tool],
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                    "deliberation_policy": "off",
                },
            )
        )
    assert excinfo.value.status_code == 400


def test_provider_deliberation_policy_auto_skips_or_deliberates_based_on_question():
    provider = MMDLiteLLMProvider(client=ScriptedClient())

    skip_response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What is the capital of France?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "deliberation_policy": "auto",
                "return_trace": True,
            },
        )
    )
    assert skip_response["mmd"]["policy"]["deliberated"] is False
    assert skip_response["mmd"]["proposals"] == []

    deliberate_response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[
                {
                    "role": "user",
                    "content": "Should we adopt microservices for our platform?",
                }
            ],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "deliberation_policy": "auto",
                "return_trace": True,
            },
        )
    )
    assert deliberate_response["mmd"]["policy"]["deliberated"] is True
    assert len(deliberate_response["mmd"]["proposals"]) == 2


def test_provider_returns_performance_in_trace():
    provider = MMDLiteLLMProvider(client=UsageScriptedClient())
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

    performance = response["mmd"]["performance"]
    assert performance["panel"]["call_count"] == 2
    assert performance["coordinator"]["call_count"] == 2
    assert performance["overall"]["total_tokens"] == 12


def test_provider_performance_duration_reflects_slow_calls():
    provider = MMDLiteLLMProvider(client=SlowScriptedClient())
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

    # 4 calls total (2 propose + normalize + compose), each sleeps ~0.05s.
    assert response["mmd"]["performance"]["overall"]["total_duration_seconds"] >= 0.05 * 4 * 0.8


def test_provider_rejects_native_web_mode_combined_with_caller_tools():
    tool = {
        "type": "function",
        "function": {
            "name": "search",
            "description": "Should be rejected alongside mmd_native_web.",
            "parameters": {"type": "object", "properties": {}},
        },
    }
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    with pytest.raises(MMDProviderBadRequestError) as excinfo:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                tools=[tool],
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                    "tool_mode": "mmd_native_web",
                },
            )
        )
    assert excinfo.value.status_code == 400
    assert "mmd_native_web" in str(excinfo.value)


def test_provider_accepts_native_web_mode_without_caller_tools():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "tool_mode": "mmd_native_web",
                "max_tool_calls": 2,
                "return_trace": True,
            },
        )
    )
    tooling = response["mmd"]["tooling"]
    assert tooling["tool_mode"] == "mmd_native_web"
    assert tooling["enabled_for_panel"] is True
    assert tooling["tool_count"] == 1
    assert tooling["tool_calls_executed"] == 0
    assert tooling["tool_call_events"] == []


def test_provider_end_to_end_executes_native_web_tool_and_surfaces_trace(monkeypatch):
    async def fake_executor(call):
        return tools_module.ToolExecutionResult(
            tool_name="web_fetch",
            arguments=call["function"]["arguments"],
            status="ok",
            content="fetched content",
            duration_seconds=0.001,
        )

    monkeypatch.setattr(tools_module, "execute_tool_call", fake_executor)

    provider = MMDLiteLLMProvider(client=ToolLoopScriptedClient())
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "tool_mode": "mmd_native_web",
                "max_tool_calls": 4,
                "return_trace": True,
            },
        )
    )
    tooling = response["mmd"]["tooling"]
    assert tooling["tool_calls_executed"] == 2
    assert tooling["tool_calls_failed"] == 0
    assert all(event["status"] == "ok" for event in tooling["tool_call_events"])
    assert all(
        event["tool_name"] == "web_fetch" for event in tooling["tool_call_events"]
    )


def test_provider_surfaces_tool_call_budget_exceeded_as_429(monkeypatch):
    async def fake_executor(call):
        return tools_module.ToolExecutionResult(
            tool_name="web_fetch",
            arguments="{}",
            status="ok",
            content="fetched content",
            duration_seconds=0.001,
        )

    monkeypatch.setattr(tools_module, "execute_tool_call", fake_executor)

    provider = MMDLiteLLMProvider(client=ToolLoopScriptedClient())
    with pytest.raises(MMDProviderToolBudgetError) as excinfo:
        asyncio.run(
            provider.acompletion(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                    "tool_mode": "mmd_native_web",
                    "max_tool_calls": 0,
                },
            )
        )
    assert excinfo.value.status_code == 429
    assert excinfo.value.code == "mmd_tool_call_budget_exceeded"

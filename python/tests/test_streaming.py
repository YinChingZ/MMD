import asyncio

import pytest

from mmd_litellm.errors import (
    MMDProviderBadRequestError,
    MMDProviderBudgetError,
    MMDProviderQuorumError,
    MMDProviderTimeoutError,
)
from mmd_litellm.litellm_provider import (
    MMDLiteLLMProvider,
    _chunk_text,
    _stream_chunks_from_response,
)
from mmd_litellm.response import openai_chat_completion_response
from tests.test_orchestrator import ScriptedClient, SlowScriptedClient, UsageScriptedClient


def test_chunk_text_splits_on_word_boundaries_under_size_limit():
    text = "Use a small TypeScript monorepo for this project."
    pieces = _chunk_text(text, chunk_size=10)
    for piece in pieces:
        assert len(piece.rstrip()) <= 10 or " " not in piece.rstrip()
    assert "".join(pieces) == text


def test_chunk_text_default_chunk_size_is_forty():
    text = "Use a small TypeScript monorepo for this project."
    assert _chunk_text(text) == _chunk_text(text, chunk_size=40)


def test_chunk_text_handles_empty_and_whitespace_only_text():
    assert _chunk_text("") == [""]
    assert _chunk_text("   \n\t  ") == [""]


def test_chunk_text_keeps_overlong_single_word_as_its_own_chunk():
    long_word = "x" * 60
    pieces = _chunk_text(long_word, chunk_size=40)
    assert pieces == [long_word]


def test_stream_chunks_from_response_shapes_interior_and_terminal_chunks():
    content = "Use the LiteLLM-shaped Python provider as the integration path."
    response = openai_chat_completion_response(content=content, model="mmd/fusion")
    chunks = _stream_chunks_from_response(response)

    assert len(chunks) > 1
    for chunk in chunks[:-1]:
        assert chunk["is_finished"] is False
        assert chunk["finish_reason"] == ""
        assert chunk["usage"] is None

    terminal = chunks[-1]
    assert terminal["is_finished"] is True
    assert terminal["finish_reason"] == "stop"
    assert terminal["usage"] == response["usage"]

    assert "".join(chunk["text"] for chunk in chunks) == content


def test_stream_chunks_from_response_omits_provider_specific_fields_when_absent():
    response = openai_chat_completion_response(content="Short answer.", model="mmd/fusion")
    chunks = _stream_chunks_from_response(response)
    assert "provider_specific_fields" not in chunks[-1]


def test_stream_chunks_from_response_includes_trace_and_analysis_in_terminal_chunk():
    response = openai_chat_completion_response(
        content="Short answer.",
        model="mmd/fusion",
        metadata={"trace_version": 1},
        analysis={"analysis_version": 1},
    )
    chunks = _stream_chunks_from_response(response)
    assert chunks[-1]["provider_specific_fields"] == {
        "mmd": {"trace_version": 1},
        "mmd_analysis": {"analysis_version": 1},
    }


def test_stream_chunks_from_response_produces_single_terminal_chunk_for_empty_content():
    response = openai_chat_completion_response(content="", model="mmd/fusion")
    chunks = _stream_chunks_from_response(response)
    assert len(chunks) == 1
    assert chunks[0]["is_finished"] is True
    assert chunks[0]["text"] == ""


def _collect_async(agen):
    async def _run():
        return [chunk async for chunk in agen]

    return asyncio.run(_run())


def test_astreaming_yields_chunks_matching_acompletion_content_and_usage():
    provider = MMDLiteLLMProvider(client=UsageScriptedClient())
    optional_params = {
        "analysis_models": ["model_a", "model_b"],
        "return_trace": True,
    }

    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params=optional_params,
        )
    )
    stream_chunks = _collect_async(
        provider.astreaming(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params=optional_params,
        )
    )

    joined = "".join(chunk["text"] for chunk in stream_chunks)
    assert joined == response["choices"][0]["message"]["content"]
    assert stream_chunks[-1]["usage"] == response["usage"]
    # Each call runs its own deliberation (run-scoped ids differ), so only compare
    # the run-independent shape rather than full trace equality.
    stream_mmd = stream_chunks[-1]["provider_specific_fields"]["mmd"]
    assert stream_mmd["trace_version"] == response["mmd"]["trace_version"]
    assert stream_mmd["mode"] == response["mmd"]["mode"]


def test_astreaming_yields_analysis_payload_in_terminal_chunk():
    provider = MMDLiteLLMProvider(client=UsageScriptedClient())
    chunks = _collect_async(
        provider.astreaming(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "return_analysis": True,
            },
        )
    )
    terminal = chunks[-1]
    assert terminal["is_finished"] is True
    analysis = terminal["provider_specific_fields"]["mmd_analysis"]
    assert analysis["analysis_version"] == 1
    assert analysis["protocol"] == "mmd.analysis.v1"
    assert analysis["mode"] == "quick"


def test_astreaming_supports_deliberation_policy_off_end_to_end():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    chunks = _collect_async(
        provider.astreaming(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "deliberation_policy": "off",
                "return_trace": True,
            },
        )
    )
    terminal = chunks[-1]
    assert terminal["is_finished"] is True
    mmd = terminal["provider_specific_fields"]["mmd"]
    assert mmd["extensions"]["policy"]["policy"] == "off"
    assert mmd["extensions"]["policy"]["deliberated"] is False
    assert mmd["candidate_sets"] == []


def test_astreaming_maps_bad_request_error_before_first_chunk():
    provider = MMDLiteLLMProvider(client=ScriptedClient())

    with pytest.raises(MMDProviderBadRequestError):
        _collect_async(
            provider.astreaming(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                    "mmd_deliberation_depth": 1,
                },
            )
        )


def test_astreaming_maps_call_budget_error():
    provider = MMDLiteLLMProvider(client=ScriptedClient())

    with pytest.raises(MMDProviderBudgetError):
        _collect_async(
            provider.astreaming(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                    "max_total_calls": 1,
                },
            )
        )


def test_astreaming_maps_run_timeout_error():
    provider = MMDLiteLLMProvider(client=SlowScriptedClient())

    with pytest.raises(MMDProviderTimeoutError):
        _collect_async(
            provider.astreaming(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                optional_params={
                    "analysis_models": ["model_a", "model_b"],
                    "max_run_timeout": 0.01,
                },
            )
        )


def test_astreaming_maps_quorum_not_met_error():
    provider = MMDLiteLLMProvider(
        client=ScriptedClient(fail_models={"model_b", "model_c"})
    )

    with pytest.raises(MMDProviderQuorumError) as exc_info:
        _collect_async(
            provider.astreaming(
                model="mmd/fusion",
                messages=[{"role": "user", "content": "What should we build next?"}],
                    optional_params={
                        "analysis_models": ["model_a", "model_b", "model_c"],
                        "mmd_mode": "standard",
                    },
            )
        )

    error = exc_info.value
    payload = error.error_payload()
    assert error.status_code == 500
    assert payload["code"] == "mmd_quorum_not_met"
    assert payload["mmd"]["phase"] == "propose"


def test_streaming_sync_wrapper_yields_same_chunks_as_astreaming():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    optional_params = {"analysis_models": ["model_a", "model_b"]}

    sync_chunks = list(
        provider.streaming(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params=optional_params,
        )
    )
    async_chunks = _collect_async(
        provider.astreaming(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params=optional_params,
        )
    )

    assert sync_chunks == async_chunks


def test_streaming_sync_wrapper_rejects_call_inside_running_event_loop():
    provider = MMDLiteLLMProvider(client=ScriptedClient())

    async def _drive():
        gen = provider.streaming(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "hi there"}],
            optional_params={"analysis_models": ["model_a", "model_b"]},
        )
        with pytest.raises(RuntimeError, match="cannot run inside an event loop"):
            next(gen)

    asyncio.run(_drive())


def test_streaming_sync_wrapper_works_outside_event_loop():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    chunks = list(
        provider.streaming(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={"analysis_models": ["model_a", "model_b"]},
        )
    )
    assert chunks[-1]["is_finished"] is True
    assert chunks[-1]["finish_reason"] == "stop"

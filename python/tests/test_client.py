import asyncio
import importlib.util

import pytest

from mmd_litellm.client import (
    LiteLLMCompletionClient,
    _extract_content,
    _extract_cost,
    _extract_tool_calls,
)
from mmd_litellm.prompts import CompletionRequest


class _HiddenParams:
    def __init__(self, response_cost):
        self.response_cost = response_cost


class _FakeResponse:
    def __init__(self, hidden_params=None):
        self._hidden_params = hidden_params


def test_extract_cost_reads_response_cost_from_attribute_style_hidden_params():
    response = _FakeResponse(_HiddenParams(0.00042))
    assert _extract_cost(response) == 0.00042


def test_extract_cost_reads_response_cost_from_dict_style_hidden_params():
    response = _FakeResponse({"response_cost": 0.0001})
    assert _extract_cost(response) == 0.0001


def test_extract_cost_returns_none_when_hidden_params_missing():
    response = _FakeResponse(hidden_params=None)
    assert _extract_cost(response) is None


def test_extract_cost_returns_none_when_response_cost_is_none():
    response = _FakeResponse(_HiddenParams(None))
    assert _extract_cost(response) is None


def test_extract_cost_returns_none_for_plain_dict_response_without_hidden_params():
    assert _extract_cost({"choices": [], "usage": {}}) is None


def test_discover_model_groups_returns_none_without_router():
    client = LiteLLMCompletionClient(router=None)
    assert client.discover_model_groups() is None


def test_discover_model_groups_returns_none_when_router_lacks_get_model_names():
    class _NoMethodRouter:
        pass

    client = LiteLLMCompletionClient(router=_NoMethodRouter())
    assert client.discover_model_groups() is None


def test_discover_model_groups_returns_none_when_router_raises():
    class _BoomRouter:
        def get_model_names(self):
            raise RuntimeError("boom")

    client = LiteLLMCompletionClient(router=_BoomRouter())
    assert client.discover_model_groups() is None


@pytest.mark.skipif(
    importlib.util.find_spec("litellm") is None,
    reason="LiteLLM is an optional runtime dependency",
)
def test_discover_model_groups_dedupes_real_router_multi_deployment_group():
    from litellm import Router

    router = Router(
        model_list=[
            {
                "model_name": "gpt-4o-mini-group",
                "litellm_params": {"model": "gpt-4o-mini", "api_key": "sk-fake-1"},
            },
            {
                "model_name": "gpt-4o-mini-group",
                "litellm_params": {"model": "gpt-4o-mini", "api_key": "sk-fake-2"},
            },
            {
                "model_name": "claude-haiku-group",
                "litellm_params": {
                    "model": "anthropic/claude-3-5-haiku",
                    "api_key": "sk-fake-3",
                },
            },
        ]
    )
    client = LiteLLMCompletionClient(router=router)

    assert client.discover_model_groups() == [
        "gpt-4o-mini-group",
        "claude-haiku-group",
    ]


class _ToolCallFunction:
    def __init__(self, name, arguments):
        self.name = name
        self.arguments = arguments


class _ToolCall:
    def __init__(self, id, function, type="function"):
        self.id = id
        self.type = type
        self.function = function


class _Message:
    def __init__(self, content=None, tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls


class _Choice:
    def __init__(self, message=None, text=None):
        self.message = message
        self.text = text


class _AttrResponse:
    def __init__(self, choices):
        self.choices = choices


def test_extract_content_returns_none_when_no_text_or_tool_calls():
    response = _AttrResponse(choices=[_Choice(message=_Message(content=None))])
    assert _extract_content(response) is None


def test_extract_content_reads_dict_style_message_content():
    response = {"choices": [{"message": {"content": "hello"}}]}
    assert _extract_content(response) == "hello"


def test_extract_content_raises_when_no_choices():
    with pytest.raises(ValueError):
        _extract_content({"choices": []})


def test_extract_tool_calls_returns_none_when_absent():
    response = _AttrResponse(choices=[_Choice(message=_Message(content="hi"))])
    assert _extract_tool_calls(response) is None


def test_extract_tool_calls_returns_none_when_no_choices():
    assert _extract_tool_calls({"choices": []}) is None


def test_extract_tool_calls_reads_dict_style_tool_calls():
    response = {
        "choices": [
            {
                "message": {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "web_fetch", "arguments": "{}"},
                        }
                    ],
                }
            }
        ]
    }
    assert _extract_tool_calls(response) == [
        {
            "id": "call_1",
            "type": "function",
            "function": {"name": "web_fetch", "arguments": "{}"},
        }
    ]


def test_extract_tool_calls_normalizes_attribute_style_tool_calls():
    tool_call = _ToolCall(
        "call_1", _ToolCallFunction("web_fetch", '{"url": "https://example.com"}')
    )
    response = _AttrResponse(
        choices=[_Choice(message=_Message(content=None, tool_calls=[tool_call]))]
    )
    assert _extract_tool_calls(response) == [
        {
            "id": "call_1",
            "type": "function",
            "function": {
                "name": "web_fetch",
                "arguments": '{"url": "https://example.com"}',
            },
        }
    ]


class _FakeRouter:
    def __init__(self, response):
        self._response = response

    async def acompletion(self, **kwargs):
        return self._response


def test_acomplete_returns_tool_calls_without_raising_when_content_absent():
    response = {
        "choices": [
            {
                "message": {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "web_fetch", "arguments": "{}"},
                        }
                    ],
                }
            }
        ]
    }
    client = LiteLLMCompletionClient(router=_FakeRouter(response))
    request = CompletionRequest(
        system_prompt="s", user_prompt="u", meta={"phase": "propose"}
    )
    output = asyncio.run(client.acomplete("model_a", request))
    assert output.text == ""
    assert output.tool_calls == [
        {
            "id": "call_1",
            "type": "function",
            "function": {"name": "web_fetch", "arguments": "{}"},
        }
    ]


def test_acomplete_still_raises_when_content_and_tool_calls_both_absent():
    response = {"choices": [{"message": {"content": None}}]}
    client = LiteLLMCompletionClient(router=_FakeRouter(response))
    request = CompletionRequest(
        system_prompt="s", user_prompt="u", meta={"phase": "propose"}
    )
    with pytest.raises(ValueError):
        asyncio.run(client.acomplete("model_a", request))

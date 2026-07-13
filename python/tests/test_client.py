import importlib.util

import pytest

from mmd_litellm.client import LiteLLMCompletionClient, _extract_cost


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

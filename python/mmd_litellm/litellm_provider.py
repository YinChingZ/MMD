from __future__ import annotations

import asyncio
from typing import Any

from .client import LiteLLMCompletionClient
from .orchestrator import CompletionClient, DeliberationConfig, run_deliberation
from .response import openai_chat_completion_response

try:
    import litellm
    from litellm import CustomLLM
except ImportError:  # Keep protocol tests runnable without the LiteLLM extra.
    litellm = None

    class CustomLLM:  # type: ignore[no-redef]
        pass


class MMDLiteLLMProvider(CustomLLM):
    """LiteLLM custom provider for the `mmd/fusion` virtual model."""

    provider_name = "mmd"

    def __init__(
        self, client: CompletionClient | None = None, router: Any | None = None
    ) -> None:
        super().__init__()
        self.client = client or LiteLLMCompletionClient(router=router)

    def completion(self, *args: Any, **kwargs: Any) -> Any:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(self.acompletion(*args, **kwargs))
        raise RuntimeError("MMDLiteLLMProvider.completion cannot run inside an event loop")

    async def acompletion(self, *args: Any, **kwargs: Any) -> Any:
        public_model = _extract_model(args, kwargs)
        optional_params = dict(kwargs.get("optional_params") or {})
        for key in (
            "analysis_models",
            "coordinator_model",
            "mmd_mode",
            "quorum_ratio",
            "per_model_timeout",
            "max_repair_attempts",
            "max_topics",
            "return_trace",
        ):
            if key in kwargs:
                optional_params[key] = kwargs[key]

        depth = optional_params.get("mmd_deliberation_depth", 0)
        if depth and int(depth) >= 1:
            raise ValueError("recursive MMD invocation is not allowed")

        question = _extract_user_question(kwargs.get("messages") or [])
        config = DeliberationConfig(
            question=question,
            analysis_models=optional_params.get("analysis_models") or [],
            coordinator_model=optional_params.get("coordinator_model"),
            mmd_mode=optional_params.get("mmd_mode", "quick"),
            quorum_ratio=optional_params.get("quorum_ratio", 0.66),
            per_model_timeout=optional_params.get("per_model_timeout", 40.0),
            max_repair_attempts=optional_params.get("max_repair_attempts", 2),
            max_topics=optional_params.get("max_topics", 8),
            return_trace=optional_params.get("return_trace", False),
        )
        result = await run_deliberation(config, self.client)
        metadata = result.trace_payload() if config.return_trace else None
        response = openai_chat_completion_response(
            content=result.response_content(),
            model=public_model,
            metadata=metadata,
            usage=result.usage.openai_usage(),
        )
        return _maybe_litellm_response(response)


def _extract_model(args: tuple[Any, ...], kwargs: dict[str, Any]) -> str:
    model = kwargs.get("model")
    if model is None and args:
        model = args[0]
    return str(model or "mmd/fusion")


def _extract_user_question(messages: list[dict[str, Any]]) -> str:
    for message in reversed(messages):
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            text_parts = [
                part.get("text", "")
                for part in content
                if isinstance(part, dict) and part.get("type") == "text"
            ]
            text = "\n".join(part for part in text_parts if part)
            if text:
                return text
    raise ValueError("MMD provider requires at least one user message with text content")


def _maybe_litellm_response(response: dict) -> Any:
    if litellm is None:
        return response
    try:
        model_response = litellm.completion(
            model="openai/gpt-3.5-turbo",
            messages=[{"role": "user", "content": "MMD response wrapper"}],
            mock_response=response["choices"][0]["message"]["content"],
        )
        model_response["model"] = response["model"]
        model_response["usage"] = response["usage"]
        if "mmd" in response:
            model_response["mmd"] = response["mmd"]
        return model_response
    except Exception:
        return response


mmd_custom_llm = MMDLiteLLMProvider()

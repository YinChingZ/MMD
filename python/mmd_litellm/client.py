from __future__ import annotations

from typing import Any

from .prompts import CompletionRequest


class LiteLLMCompletionClient:
    async def acomplete(
        self,
        model: str,
        request: CompletionRequest,
        *,
        timeout: float | None = None,
    ) -> str:
        try:
            import litellm
        except ImportError as error:
            raise RuntimeError(
                "litellm is required for real model calls; install mmd-litellm[litellm]"
            ) from error

        response = await litellm.acompletion(
            model=model,
            messages=request.to_messages(),
            timeout=timeout,
            metadata={"mmd_deliberation_depth": 1, **request.meta},
        )
        return _extract_content(response)


def _extract_content(response: Any) -> str:
    choices = _get(response, "choices")
    if not choices:
        raise ValueError("LiteLLM response contained no choices")
    first_choice = choices[0]
    message = _get(first_choice, "message")
    content = _get(message, "content") if message is not None else None
    if isinstance(content, str):
        return content
    text = _get(first_choice, "text")
    if isinstance(text, str):
        return text
    raise ValueError("LiteLLM response contained no text content")


def _get(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        return value.get(key)
    return getattr(value, key, None)


from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from .prompts import CompletionRequest


class TokenUsage(BaseModel):
    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)


class CompletionOutput(BaseModel):
    text: str
    usage: TokenUsage | None = None


class LiteLLMCompletionClient:
    def __init__(self, router: Any | None = None) -> None:
        self.router = router

    async def acomplete(
        self,
        model: str,
        request: CompletionRequest,
        *,
        timeout: float | None = None,
    ) -> CompletionOutput:
        if self.router is None:
            try:
                import litellm
            except ImportError as error:
                raise RuntimeError(
                    "litellm is required for real model calls; install mmd-litellm[litellm]"
                ) from error
            acompletion = litellm.acompletion
        else:
            acompletion = self.router.acompletion

        call_kwargs = dict(request.litellm_params)
        metadata = {"mmd_deliberation_depth": 1, **request.meta}
        request_metadata = call_kwargs.pop("metadata", None)
        if isinstance(request_metadata, dict):
            metadata = {**request_metadata, **metadata}
        if timeout is not None:
            call_kwargs["timeout"] = timeout

        response = await acompletion(
            model=model,
            messages=request.to_messages(),
            metadata=metadata,
            **call_kwargs,
        )
        return CompletionOutput(
            text=_extract_content(response),
            usage=_extract_usage(response),
        )


def coerce_completion_output(value: str | CompletionOutput) -> CompletionOutput:
    if isinstance(value, CompletionOutput):
        return value
    if isinstance(value, str):
        return CompletionOutput(text=value)
    raise TypeError(f"completion client returned unsupported value: {type(value)!r}")


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


def _extract_usage(response: Any) -> TokenUsage | None:
    usage = _get(response, "usage")
    if usage is None:
        return None

    prompt_tokens = _int_or_zero(_get(usage, "prompt_tokens"))
    completion_tokens = _int_or_zero(_get(usage, "completion_tokens"))
    total_tokens = _int_or_zero(_get(usage, "total_tokens"))
    if total_tokens == 0 and (prompt_tokens or completion_tokens):
        total_tokens = prompt_tokens + completion_tokens
    return TokenUsage(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
    )


def _int_or_zero(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(value, 0)
    if isinstance(value, float):
        return max(int(value), 0)
    return 0


def _get(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        return value.get(key)
    return getattr(value, key, None)

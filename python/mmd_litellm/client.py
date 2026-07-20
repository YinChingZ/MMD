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
    tool_calls: list[dict[str, Any]] | None = None
    usage: TokenUsage | None = None
    cost_usd: float | None = None


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
        content = _extract_content(response)
        tool_calls = _extract_tool_calls(response)
        if content is None and not tool_calls:
            raise ValueError("LiteLLM response contained no text content")
        return CompletionOutput(
            text=content or "",
            tool_calls=tool_calls,
            usage=_extract_usage(response),
            cost_usd=_extract_cost(response),
        )

    def discover_model_groups(self) -> list[str] | None:
        """Best-effort discovery of caller-facing model group/alias names known to
        the injected Router, for default-panel resolution when `analysis_models` is
        omitted (see `litellm_provider._resolve_analysis_models`).

        Returns `None` when there is nothing safe to discover: no router was
        injected (direct `litellm.acompletion`/bare-SDK mode has no notion of
        "available models"), or introspection failed/behaved unexpectedly. This is
        an informally-stable LiteLLM surface (heavily relied on by LiteLLM's own
        Proxy code), not a formally versioned public API - any failure here must
        degrade to "no default panel available," never crash the request.

        Deliberately reads `router.get_model_names()` and NEVER
        `router.model_list` / `router.get_model_list()`: those return live,
        resolved deployment configs including plaintext `litellm_params.api_key`
        (confirmed empirically against litellm==1.91.0). `get_model_names()`
        returns only caller-facing `model_name` group/alias strings, one entry per
        deployment (so a multi-deployment group appears more than once) - deduped
        here while preserving order (`dict.fromkeys`, not `set()`), since
        downstream truncation (`DeliberationConfig.validate_and_limit_models`)
        takes the first N names.
        """
        if self.router is None:
            return None
        try:
            names = self.router.get_model_names()
            return list(dict.fromkeys(names))
        except Exception:
            return None

    def count_tokens(self, model: str, text: str) -> int | None:
        """Use LiteLLM's tokenizer when available; protocol code stays optional."""

        try:
            import litellm

            return int(litellm.token_counter(model=model, text=text))
        except Exception:
            return None

    def context_window(self, model: str) -> int | None:
        """Best-effort model input capacity from LiteLLM/Router metadata."""

        try:
            if self.router is not None:
                getter = getattr(self.router, "get_model_info", None)
                if callable(getter):
                    info = getter(model)
                    window = _context_window_from_info(info)
                    if window is not None:
                        return window
            import litellm

            return _context_window_from_info(litellm.get_model_info(model))
        except Exception:
            return None


def coerce_completion_output(value: str | CompletionOutput) -> CompletionOutput:
    if isinstance(value, CompletionOutput):
        return value
    if isinstance(value, str):
        return CompletionOutput(text=value)
    raise TypeError(f"completion client returned unsupported value: {type(value)!r}")


def _extract_content(response: Any) -> str | None:
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
    return None


def _extract_tool_calls(response: Any) -> list[dict[str, Any]] | None:
    choices = _get(response, "choices")
    if not choices:
        return None
    message = _get(choices[0], "message")
    if message is None:
        return None
    tool_calls = _get(message, "tool_calls")
    if not tool_calls:
        return None
    normalized = []
    for call in tool_calls:
        if isinstance(call, dict):
            normalized.append(call)
            continue
        function = getattr(call, "function", None)
        normalized.append(
            {
                "id": getattr(call, "id", ""),
                "type": getattr(call, "type", "function"),
                "function": {
                    "name": getattr(function, "name", ""),
                    "arguments": getattr(function, "arguments", ""),
                },
            }
        )
    return normalized or None


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


def _extract_cost(response: Any) -> float | None:
    """Read LiteLLM's own already-computed cost off the response, if present.

    LiteLLM populates `_hidden_params["response_cost"]` on every real completion
    via its own pricing map (the same one `litellm.cost_per_token` reads) - reusing
    it here means MMD never runs a second, possibly-diverging cost computation for
    calls that actually went through LiteLLM. It's `None` when LiteLLM couldn't
    price the model (mirrors `litellm.cost_per_token` being unable to either).
    """
    hidden_params = _get(response, "_hidden_params")
    if hidden_params is None:
        return None
    cost = _get(hidden_params, "response_cost")
    if isinstance(cost, (int, float)) and not isinstance(cost, bool):
        return float(cost)
    return None


def _int_or_zero(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(value, 0)
    if isinstance(value, float):
        return max(int(value), 0)
    return 0


def _context_window_from_info(info: Any) -> int | None:
    for key in ("max_input_tokens", "max_tokens", "context_window"):
        value = _get(info, key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
            return int(value)
    return None


def _get(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        return value.get(key)
    return getattr(value, key, None)

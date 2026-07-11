from __future__ import annotations

import asyncio
import inspect
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Iterator

from pydantic import ValidationError

from .client import LiteLLMCompletionClient
from .conversation import extract_conversation
from .errors import (
    MMDProviderAPIError,
    MMDProviderBadRequestError,
    MMDProviderBudgetError,
    MMDProviderError,
    MMDProviderQuorumError,
    MMDProviderTimeoutError,
)
from .orchestrator import (
    CompletionClient,
    CallBudgetExceededError,
    DeliberationTimeoutError,
    DeliberationConfig,
    QuorumNotMetError,
    run_deliberation,
)
from .response import openai_chat_completion_response

try:
    import litellm
    from litellm import CustomLLM
    from litellm.types.utils import ModelResponse
except ImportError:  # Keep protocol tests runnable without the LiteLLM extra.
    litellm = None

    class CustomLLM:  # type: ignore[no-redef]
        pass

    class ModelResponse:  # type: ignore[no-redef]
        """Placeholder only; never instantiated when litellm isn't installed."""


class MMDLiteLLMProvider(CustomLLM):
    """LiteLLM custom provider for the `mmd/fusion` virtual model."""

    provider_name = "mmd"

    def __init__(
        self,
        client: CompletionClient | None = None,
        router: Any | None = None,
        trace_logger: Any | None = None,
    ) -> None:
        super().__init__()
        self.client = client or LiteLLMCompletionClient(router=router)
        self.trace_logger = trace_logger

    def completion(
        self,
        model: str,
        messages: list[dict[str, Any]],
        model_response: Any | None = None,
        optional_params: dict[str, Any] | None = None,
        logging_obj: Any | None = None,
        **kwargs: Any,
    ) -> Any:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(
                self.acompletion(
                    model=model,
                    messages=messages,
                    model_response=model_response,
                    optional_params=optional_params,
                    logging_obj=logging_obj,
                    **kwargs,
                )
            )
        raise RuntimeError("MMDLiteLLMProvider.completion cannot run inside an event loop")

    async def acompletion(
        self,
        model: str,
        messages: list[dict[str, Any]],
        model_response: Any | None = None,
        optional_params: dict[str, Any] | None = None,
        logging_obj: Any | None = None,
        **kwargs: Any,
    ) -> Any:
        public_model = str(model or "mmd/fusion")
        response = await self._run_deliberation_and_build_response(
            public_model=public_model,
            messages=messages,
            optional_params=optional_params,
            logging_obj=logging_obj,
            extra=kwargs,
        )
        return _finalize_response(response, model_response)

    async def astreaming(
        self,
        model: str,
        messages: list[dict[str, Any]],
        model_response: Any | None = None,
        optional_params: dict[str, Any] | None = None,
        logging_obj: Any | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[dict[str, Any]]:
        public_model = str(model or "mmd/fusion")
        response = await self._run_deliberation_and_build_response(
            public_model=public_model,
            messages=messages,
            optional_params=optional_params,
            logging_obj=logging_obj,
            extra=kwargs,
        )
        for chunk in _stream_chunks_from_response(response):
            yield chunk

    def streaming(
        self,
        model: str,
        messages: list[dict[str, Any]],
        model_response: Any | None = None,
        optional_params: dict[str, Any] | None = None,
        logging_obj: Any | None = None,
        **kwargs: Any,
    ) -> Iterator[dict[str, Any]]:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            pass
        else:
            raise RuntimeError("MMDLiteLLMProvider.streaming cannot run inside an event loop")

        async def _collect() -> list[dict[str, Any]]:
            return [
                chunk
                async for chunk in self.astreaming(
                    model=model,
                    messages=messages,
                    model_response=model_response,
                    optional_params=optional_params,
                    logging_obj=logging_obj,
                    **kwargs,
                )
            ]

        yield from asyncio.run(_collect())

    async def _run_deliberation_and_build_response(
        self,
        *,
        public_model: str,
        messages: list[dict[str, Any]],
        optional_params: dict[str, Any] | None,
        logging_obj: Any | None,
        extra: dict[str, Any],
    ) -> dict[str, Any]:
        try:
            return await self._acompletion_impl(
                public_model=public_model,
                messages=messages,
                optional_params=optional_params,
                logging_obj=logging_obj,
                extra=extra,
            )
        except MMDProviderError:
            raise
        except Exception as error:
            raise _provider_api_error(public_model, error) from error

    async def _acompletion_impl(
        self,
        *,
        public_model: str,
        messages: list[dict[str, Any]],
        optional_params: dict[str, Any] | None,
        logging_obj: Any | None,
        extra: dict[str, Any],
    ) -> dict[str, Any]:
        merged_optional_params = dict(optional_params or {})
        for key in (
            "analysis_models",
            "coordinator_model",
            "preset",
            "mmd_mode",
            "quorum_ratio",
            "per_model_timeout",
            "max_run_timeout",
            "max_total_calls",
            "max_repair_attempts",
            "max_topics",
            "max_analysis_models",
            "max_completion_tokens",
            "temperature",
            "coordinator_temperature",
            "reasoning",
            "tools",
            "tool_choice",
            "max_tool_calls",
            "coordinator_tools_enabled",
            "tool_mode",
            "model_params",
            "analysis_model_params",
            "coordinator_model_params",
            "return_trace",
            "return_analysis",
            "mmd_log_trace",
            "max_log_trace_candidates",
            "mmd_trace_logger",
        ):
            if key in extra:
                merged_optional_params[key] = extra[key]

        config = _build_config(
            public_model=public_model,
            messages=messages,
            optional_params=merged_optional_params,
        )
        try:
            result = await run_deliberation(config, self.client)
        except CallBudgetExceededError as error:
            raise _provider_budget_error(public_model, error) from error
        except DeliberationTimeoutError as error:
            raise _provider_timeout_error(public_model, error) from error
        except QuorumNotMetError as error:
            raise _provider_quorum_error(public_model, error) from error
        except Exception as error:
            raise _provider_api_error(public_model, error) from error

        metadata = result.trace_payload() if config.return_trace else None
        analysis = (
            result.analysis_payload()
            if bool(merged_optional_params.get("return_analysis", False))
            else None
        )
        response = openai_chat_completion_response(
            content=result.response_content(),
            model=public_model,
            metadata=metadata,
            analysis=analysis,
            usage=result.usage.openai_usage(),
        )
        trace_logging = await _emit_trace_logging(
            enabled=bool(merged_optional_params.get("mmd_log_trace", False)),
            payload=result.logging_trace_payload(
                max_candidates=config.max_log_trace_candidates
            ),
            request_kwargs={"messages": messages, "metadata": extra.get("metadata")},
            response=response,
            public_model=public_model,
            optional_params=merged_optional_params,
            configured_logger=self.trace_logger,
            logging_obj=logging_obj,
        )
        if metadata is not None and trace_logging["attempted"]:
            metadata["trace_logging"] = trace_logging
        return response


def _build_config(
    *,
    public_model: str,
    messages: list[dict[str, Any]],
    optional_params: dict[str, Any],
) -> DeliberationConfig:
    try:
        depth = optional_params.get("mmd_deliberation_depth", 0)
        if depth and int(depth) >= 1:
            raise ValueError("recursive MMD invocation is not allowed")

        tool_mode = optional_params.get("tool_mode", "reject")
        has_tool_intent = bool(optional_params.get("tools")) or (
            optional_params.get("tool_choice") is not None
        )
        if has_tool_intent and tool_mode == "reject":
            raise ValueError(
                "MMD does not execute a tool-calling loop; this request includes "
                "tools/tool_choice. Set tool_mode='experimental_passthrough' to opt "
                "into raw (unexecuted) passthrough of tools/tool_choice to "
                "panel/coordinator models, or remove tools/tool_choice from the "
                "request."
            )

        conversation = extract_conversation(messages or [])
        return DeliberationConfig(
            question=conversation.question,
            conversation_context=conversation.rendered_context_block(),
            analysis_models=optional_params.get("analysis_models") or [],
            coordinator_model=optional_params.get("coordinator_model"),
            preset=optional_params.get("preset"),
            mmd_mode=optional_params.get("mmd_mode", "quick"),
            quorum_ratio=optional_params.get("quorum_ratio", 0.66),
            per_model_timeout=optional_params.get("per_model_timeout"),
            max_run_timeout=optional_params.get("max_run_timeout"),
            max_total_calls=optional_params.get("max_total_calls"),
            max_log_trace_candidates=optional_params.get(
                "max_log_trace_candidates", 50
            ),
            max_repair_attempts=optional_params.get("max_repair_attempts", 2),
            max_topics=optional_params.get("max_topics", 8),
            max_analysis_models=optional_params.get("max_analysis_models"),
            max_completion_tokens=optional_params.get("max_completion_tokens"),
            temperature=optional_params.get("temperature"),
            coordinator_temperature=optional_params.get(
                "coordinator_temperature", 0.1
            ),
            reasoning=optional_params.get("reasoning"),
            tools=optional_params.get("tools") or [],
            tool_choice=optional_params.get("tool_choice"),
            max_tool_calls=optional_params.get("max_tool_calls"),
            coordinator_tools_enabled=optional_params.get(
                "coordinator_tools_enabled", False
            ),
            tool_mode=tool_mode,
            model_params=optional_params.get("model_params") or {},
            analysis_model_params=optional_params.get("analysis_model_params") or {},
            coordinator_model_params=optional_params.get(
                "coordinator_model_params"
            )
            or {},
            return_trace=optional_params.get("return_trace", False),
        )
    except MMDProviderError:
        raise
    except (TypeError, ValueError, ValidationError) as error:
        raise MMDProviderBadRequestError(
            f"invalid MMD provider request: {error}",
            model=public_model,
            details={"cause": type(error).__name__},
        ) from error


def _provider_quorum_error(
    public_model: str, error: QuorumNotMetError
) -> MMDProviderQuorumError:
    return MMDProviderQuorumError(
        str(error),
        model=public_model,
        details={
            "phase": error.phase,
            "quorum": error.quorum.model_dump(mode="json"),
            "failures": [
                failure.model_dump(mode="json") for failure in error.failures
            ],
        },
    )


def _provider_timeout_error(
    public_model: str, error: DeliberationTimeoutError
) -> MMDProviderTimeoutError:
    return MMDProviderTimeoutError(
        str(error),
        model=public_model,
        details={"max_run_timeout": error.max_run_timeout},
    )


def _provider_budget_error(
    public_model: str, error: CallBudgetExceededError
) -> MMDProviderBudgetError:
    return MMDProviderBudgetError(
        str(error),
        model=public_model,
        details={"max_total_calls": error.max_total_calls},
    )


def _provider_api_error(public_model: str, error: Exception) -> MMDProviderAPIError:
    return MMDProviderAPIError(
        f"MMD provider execution failed: {error}",
        model=public_model,
        details={"cause": type(error).__name__},
    )


def _finalize_response(response: dict, model_response: Any | None) -> Any:
    """Populate the caller-supplied ``ModelResponse`` in place, or build a fresh one.

    LiteLLM's ``CustomLLM`` dispatch always passes a ``model_response`` object to
    populate. ``ModelResponse`` supports attribute assignment but not ``__setitem__``
    (e.g. ``mr.model = x`` works, ``mr["model"] = x`` raises), so mutation below is
    attribute-based throughout.
    """
    if model_response is not None:
        _populate_model_response(model_response, response)
        return model_response
    if litellm is None:
        return response
    fresh = ModelResponse()
    _populate_model_response(fresh, response)
    return fresh


def _populate_model_response(target: Any, response: dict) -> None:
    message = response["choices"][0]["message"]
    target.id = response["id"]
    target.created = response["created"]
    target.model = response["model"]
    target.object = response.get("object", "chat.completion")
    choice = target.choices[0]
    choice.finish_reason = response["choices"][0].get("finish_reason", "stop")
    choice.message.role = message.get("role", "assistant")
    choice.message.content = message["content"]
    if response.get("usage"):
        target.usage = response["usage"]
    if "mmd" in response:
        target.mmd = response["mmd"]
    if "mmd_analysis" in response:
        target.mmd_analysis = response["mmd_analysis"]


def _chunk_text(text: str, chunk_size: int = 40) -> list[str]:
    """Greedily pack whitespace-split words into pieces <= chunk_size chars.

    An over-long single word is kept whole as its own chunk. Always returns at
    least one chunk (possibly "") so terminal-chunk logic stays uniform for
    empty/short content. Internal whitespace runs (including newlines) are
    normalized to single spaces. Every chunk but the last carries a trailing
    space so that raw concatenation (`"".join(chunks)`, as a real streaming
    client does with successive `delta.content` values) reconstructs the
    original text exactly -- callers must NOT re-join with an extra separator.
    """
    words = text.split()
    if not words:
        return [""]
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for word in words:
        added_len = len(word) if not current else len(word) + 1
        if current and current_len + added_len > chunk_size:
            chunks.append(" ".join(current) + " ")
            current, current_len = [word], len(word)
        else:
            current.append(word)
            current_len += added_len
    chunks.append(" ".join(current))
    return chunks


def _stream_chunks_from_response(response: dict) -> list[dict[str, Any]]:
    """Translate the non-streaming `response` dict into GenericStreamingChunk-shaped
    dicts. Streaming and non-streaming expose identical content/usage/trace/analysis
    -- only delivery shape differs. `mmd`/`mmd_analysis`, when present, are exposed via
    `provider_specific_fields` on the terminal chunk (LiteLLM's CustomStreamWrapper
    applies these via setattr onto that chunk's stream object).
    """
    message = response["choices"][0]["message"]
    pieces = _chunk_text(message.get("content") or "")

    chunks: list[dict[str, Any]] = [
        {"text": piece, "is_finished": False, "finish_reason": "", "usage": None}
        for piece in pieces[:-1]
    ]

    provider_specific_fields: dict[str, Any] = {}
    if "mmd" in response:
        provider_specific_fields["mmd"] = response["mmd"]
    if "mmd_analysis" in response:
        provider_specific_fields["mmd_analysis"] = response["mmd_analysis"]

    terminal: dict[str, Any] = {
        "text": pieces[-1],
        "is_finished": True,
        "finish_reason": response["choices"][0].get("finish_reason", "stop"),
        "usage": response.get("usage"),
    }
    if provider_specific_fields:
        terminal["provider_specific_fields"] = provider_specific_fields
    chunks.append(terminal)
    return chunks


async def _emit_trace_logging(
    *,
    enabled: bool,
    payload: dict[str, Any],
    request_kwargs: dict[str, Any],
    response: dict,
    public_model: str,
    optional_params: dict[str, Any],
    configured_logger: Any | None,
    logging_obj: Any | None,
) -> dict[str, Any]:
    status: dict[str, Any] = {
        "attempted": enabled,
        "delivered": 0,
        "failures": [],
    }
    if not enabled:
        return status

    if _attach_trace_to_litellm_logging(logging_obj, payload):
        status["attached_to_litellm_logging"] = True

    loggers = _trace_loggers(configured_logger, optional_params)
    if not loggers and not status.get("attached_to_litellm_logging"):
        status["failures"].append("no trace logger configured")
        return status

    event_kwargs = _trace_event_kwargs(
        request_kwargs=request_kwargs,
        public_model=public_model,
        optional_params=optional_params,
        payload=payload,
    )
    end_time = datetime.now(timezone.utc)
    start_time = end_time

    for logger in loggers:
        try:
            await _call_trace_logger(
                logger,
                event_kwargs,
                response,
                start_time,
                end_time,
                payload,
            )
            status["delivered"] += 1
        except Exception as error:
            status["failures"].append(str(error))
    return status


def _attach_trace_to_litellm_logging(
    logging_obj: Any | None, payload: dict[str, Any]
) -> bool:
    """Hand the payload to LiteLLM's request-scoped callback pipeline.

    LiteLLM invokes success callbacks after a custom provider returns. Attaching
    MMD's opt-in audit payload to that request context avoids independently
    invoking global callbacks here, which would otherwise duplicate log events.
    """
    if logging_obj is None:
        return False
    details = getattr(logging_obj, "model_call_details", None)
    if not isinstance(details, dict):
        return False
    details["mmd"] = payload
    return True


def _trace_loggers(
    configured_logger: Any | None, optional_params: dict[str, Any]
) -> list[Any]:
    raw_loggers: list[Any] = []
    for candidate in (
        configured_logger,
        optional_params.get("mmd_trace_logger"),
        optional_params.get("mmd_trace_loggers"),
    ):
        if candidate is None:
            continue
        if isinstance(candidate, (list, tuple)):
            raw_loggers.extend(candidate)
        else:
            raw_loggers.append(candidate)

    loggers: list[Any] = []
    seen: set[int] = set()
    for logger in raw_loggers:
        if isinstance(logger, str):
            continue
        identity = id(logger)
        if identity in seen:
            continue
        seen.add(identity)
        loggers.append(logger)
    return loggers


def _trace_event_kwargs(
    *,
    request_kwargs: dict[str, Any],
    public_model: str,
    optional_params: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    metadata = dict(request_kwargs.get("metadata") or {})
    metadata["mmd"] = payload
    return {
        "model": public_model,
        "messages": request_kwargs.get("messages") or [],
        "metadata": metadata,
        "optional_params": _json_safe_optional_params(optional_params),
        "mmd": payload,
    }


def _json_safe_optional_params(optional_params: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in optional_params.items()
        if key not in {"mmd_trace_logger", "mmd_trace_loggers"}
    }


async def _call_trace_logger(
    logger: Any,
    event_kwargs: dict[str, Any],
    response: dict,
    start_time: datetime,
    end_time: datetime,
    payload: dict[str, Any],
) -> None:
    if hasattr(logger, "async_log_success_event"):
        result = logger.async_log_success_event(
            event_kwargs,
            response,
            start_time,
            end_time,
        )
        if inspect.isawaitable(result):
            await result
        return
    if hasattr(logger, "log_success_event"):
        logger.log_success_event(event_kwargs, response, start_time, end_time)
        return
    if callable(logger):
        result = logger(payload)
        if inspect.isawaitable(result):
            await result
        return
    raise TypeError(f"unsupported trace logger: {type(logger)!r}")


mmd_custom_llm = MMDLiteLLMProvider()

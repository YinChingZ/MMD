from __future__ import annotations

import asyncio
import inspect
from datetime import datetime, timezone
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
        self,
        client: CompletionClient | None = None,
        router: Any | None = None,
        trace_logger: Any | None = None,
    ) -> None:
        super().__init__()
        self.client = client or LiteLLMCompletionClient(router=router)
        self.trace_logger = trace_logger

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
            "return_analysis",
            "mmd_log_trace",
            "mmd_trace_logger",
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
        analysis = (
            result.analysis_payload()
            if bool(optional_params.get("return_analysis", False))
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
            enabled=bool(optional_params.get("mmd_log_trace", False)),
            payload=result.logging_trace_payload(),
            request_kwargs=kwargs,
            response=response,
            public_model=public_model,
            optional_params=optional_params,
            configured_logger=self.trace_logger,
        )
        if metadata is not None and trace_logging["attempted"]:
            metadata["trace_logging"] = trace_logging
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
        if "mmd_analysis" in response:
            model_response["mmd_analysis"] = response["mmd_analysis"]
        return model_response
    except Exception:
        return response


async def _emit_trace_logging(
    *,
    enabled: bool,
    payload: dict[str, Any],
    request_kwargs: dict[str, Any],
    response: dict,
    public_model: str,
    optional_params: dict[str, Any],
    configured_logger: Any | None,
) -> dict[str, Any]:
    status: dict[str, Any] = {
        "attempted": enabled,
        "delivered": 0,
        "failures": [],
    }
    if not enabled:
        return status

    loggers = _trace_loggers(configured_logger, optional_params)
    if not loggers:
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

    if litellm is not None:
        raw_loggers.extend(_object_callbacks(getattr(litellm, "success_callback", [])))
        raw_loggers.extend(_object_callbacks(getattr(litellm, "callbacks", [])))

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


def _object_callbacks(callbacks: Any) -> list[Any]:
    if callbacks is None:
        return []
    if isinstance(callbacks, (list, tuple)):
        return [callback for callback in callbacks if not isinstance(callback, str)]
    if isinstance(callbacks, str):
        return []
    return [callbacks]


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

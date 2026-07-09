from __future__ import annotations

from typing import Any

try:
    from litellm.exceptions import APIError as LiteLLMAPIError
    from litellm.exceptions import BadRequestError as LiteLLMBadRequestError
except ImportError:  # The protocol core intentionally has no LiteLLM dependency.
    LiteLLMAPIError = None
    LiteLLMBadRequestError = None


class MMDProviderError(Exception):
    """Provider-facing error with OpenAI/LiteLLM-compatible metadata."""

    status_code = 500
    error_type = "api_error"
    code = "mmd_provider_error"

    def __init__(
        self,
        message: str,
        *,
        model: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        # Do not use cooperative ``super()`` here: native LiteLLM exception
        # classes require provider-specific constructor arguments.
        Exception.__init__(self, message)
        self._mmd_message = message
        self._mmd_error_type = self.error_type
        self._mmd_code = self.code
        self.model = model
        self.details = details or {}

    def error_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "message": self._mmd_message,
            "type": self._mmd_error_type,
            "code": self._mmd_code,
        }
        if self.model is not None:
            payload["model"] = self.model
        if self.details:
            payload["mmd"] = self.details
        return payload


if LiteLLMBadRequestError is not None:

    class MMDProviderBadRequestError(MMDProviderError, LiteLLMBadRequestError):
        """Bad request that LiteLLM can classify without wrapping it again."""

        status_code = 400
        error_type = "bad_request_error"
        code = "mmd_bad_request"

        def __init__(
            self,
            message: str,
            *,
            model: str | None = None,
            details: dict[str, Any] | None = None,
        ) -> None:
            MMDProviderError.__init__(self, message, model=model, details=details)
            LiteLLMBadRequestError.__init__(
                self,
                message=message,
                model=model or "mmd/fusion",
                llm_provider="mmd",
                body=self.error_payload(),
            )
            self.code = self._mmd_code


else:

    class MMDProviderBadRequestError(MMDProviderError, ValueError):
        status_code = 400
        error_type = "bad_request_error"
        code = "mmd_bad_request"


if LiteLLMAPIError is not None:

    class MMDProviderAPIError(MMDProviderError, LiteLLMAPIError):
        """Runtime error that preserves LiteLLM's native API error contract."""

        status_code = 500
        error_type = "api_error"
        code = "mmd_api_error"

        def __init__(
            self,
            message: str,
            *,
            model: str | None = None,
            details: dict[str, Any] | None = None,
        ) -> None:
            MMDProviderError.__init__(self, message, model=model, details=details)
            LiteLLMAPIError.__init__(
                self,
                status_code=self.status_code,
                message=message,
                llm_provider="mmd",
                model=model or "mmd/fusion",
            )
            self.code = self._mmd_code


else:

    class MMDProviderAPIError(MMDProviderError, RuntimeError):
        status_code = 500
        error_type = "api_error"
        code = "mmd_api_error"


class MMDProviderQuorumError(MMDProviderAPIError):
    code = "mmd_quorum_not_met"


class MMDProviderTimeoutError(MMDProviderAPIError):
    status_code = 504
    code = "mmd_run_timeout"


class MMDProviderBudgetError(MMDProviderAPIError):
    status_code = 429
    code = "mmd_call_budget_exceeded"

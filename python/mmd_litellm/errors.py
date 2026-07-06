from __future__ import annotations

from typing import Any


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
        super().__init__(message)
        self.model = model
        self.details = details or {}

    def error_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "message": str(self),
            "type": self.error_type,
            "code": self.code,
        }
        if self.model is not None:
            payload["model"] = self.model
        if self.details:
            payload["mmd"] = self.details
        return payload


class MMDProviderBadRequestError(MMDProviderError, ValueError):
    status_code = 400
    error_type = "bad_request_error"
    code = "mmd_bad_request"


class MMDProviderAPIError(MMDProviderError, RuntimeError):
    status_code = 500
    error_type = "api_error"
    code = "mmd_api_error"


class MMDProviderQuorumError(MMDProviderAPIError):
    code = "mmd_quorum_not_met"

"""Auditable multi-model deliberation provider for LiteLLM."""

from .consensus import (
    DEFAULT_CONSENSUS_THRESHOLDS,
    ClassifyCandidateResult,
    ConsensusThresholds,
    classify_candidate,
)
from .errors import (
    MMDProviderAPIError,
    MMDProviderBadRequestError,
    MMDProviderBudgetError,
    MMDProviderError,
    MMDProviderQuorumError,
    MMDProviderTimeoutError,
)
from .ids import make_run_id, parse_scoped_id, scoped_id
from .litellm_provider import MMDLiteLLMProvider, mmd_custom_llm
from .orchestrator import (
    DeliberationConfig,
    DeliberationResult,
    CallBudgetExceededError,
    DeliberationTimeoutError,
    QuorumNotMetError,
    run_deliberation,
    run_planning_deliberation,
    run_quick_deliberation,
    run_standard_deliberation,
)
from .quorum import QuorumCheck, check_quorum, compute_quorum, meets_quorum

__all__ = [
    "ClassifyCandidateResult",
    "CallBudgetExceededError",
    "ConsensusThresholds",
    "DEFAULT_CONSENSUS_THRESHOLDS",
    "DeliberationConfig",
    "DeliberationResult",
    "DeliberationTimeoutError",
    "MMDProviderAPIError",
    "MMDProviderBadRequestError",
    "MMDProviderBudgetError",
    "MMDProviderError",
    "MMDProviderQuorumError",
    "MMDProviderTimeoutError",
    "MMDLiteLLMProvider",
    "QuorumCheck",
    "QuorumNotMetError",
    "check_quorum",
    "classify_candidate",
    "compute_quorum",
    "make_run_id",
    "meets_quorum",
    "mmd_custom_llm",
    "parse_scoped_id",
    "run_deliberation",
    "run_planning_deliberation",
    "run_quick_deliberation",
    "run_standard_deliberation",
    "scoped_id",
]

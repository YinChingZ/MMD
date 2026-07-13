"""Auditable multi-model deliberation provider for LiteLLM."""

from .consensus import (
    DEFAULT_CONSENSUS_THRESHOLDS,
    ClassifyCandidateResult,
    ConsensusThresholds,
    classify_candidate,
)
from .cost import CostEstimate, estimate_call_cost
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
    PerformanceSummary,
    QuorumNotMetError,
    RolePerformance,
    run_deliberation,
    run_planning_deliberation,
    run_quick_deliberation,
    run_standard_deliberation,
)
from .policy import (
    AutoPolicyDecision,
    DeliberationPolicy,
    PolicyTraceInfo,
    decide_auto_deliberation,
    resolve_deliberation_policy,
)
from .quorum import QuorumCheck, check_quorum, compute_quorum, meets_quorum

__all__ = [
    "AutoPolicyDecision",
    "ClassifyCandidateResult",
    "CallBudgetExceededError",
    "ConsensusThresholds",
    "CostEstimate",
    "DEFAULT_CONSENSUS_THRESHOLDS",
    "DeliberationConfig",
    "DeliberationPolicy",
    "DeliberationResult",
    "DeliberationTimeoutError",
    "MMDProviderAPIError",
    "MMDProviderBadRequestError",
    "MMDProviderBudgetError",
    "MMDProviderError",
    "MMDProviderQuorumError",
    "MMDProviderTimeoutError",
    "MMDLiteLLMProvider",
    "PerformanceSummary",
    "PolicyTraceInfo",
    "QuorumCheck",
    "QuorumNotMetError",
    "RolePerformance",
    "check_quorum",
    "classify_candidate",
    "compute_quorum",
    "decide_auto_deliberation",
    "estimate_call_cost",
    "make_run_id",
    "meets_quorum",
    "mmd_custom_llm",
    "parse_scoped_id",
    "resolve_deliberation_policy",
    "run_deliberation",
    "run_planning_deliberation",
    "run_quick_deliberation",
    "run_standard_deliberation",
    "scoped_id",
]

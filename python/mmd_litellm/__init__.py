"""LiteLLM-shaped Python PoC for MMD."""

from .consensus import (
    DEFAULT_CONSENSUS_THRESHOLDS,
    ClassifyCandidateResult,
    ConsensusThresholds,
    classify_candidate,
)
from .errors import (
    MMDProviderAPIError,
    MMDProviderBadRequestError,
    MMDProviderError,
    MMDProviderQuorumError,
)
from .ids import make_run_id, parse_scoped_id, scoped_id
from .orchestrator import (
    DeliberationConfig,
    DeliberationResult,
    QuorumNotMetError,
    run_deliberation,
    run_planning_deliberation,
    run_quick_deliberation,
    run_standard_deliberation,
)
from .quorum import QuorumCheck, check_quorum, compute_quorum, meets_quorum

__all__ = [
    "ClassifyCandidateResult",
    "ConsensusThresholds",
    "DEFAULT_CONSENSUS_THRESHOLDS",
    "DeliberationConfig",
    "DeliberationResult",
    "MMDProviderAPIError",
    "MMDProviderBadRequestError",
    "MMDProviderError",
    "MMDProviderQuorumError",
    "QuorumCheck",
    "QuorumNotMetError",
    "check_quorum",
    "classify_candidate",
    "compute_quorum",
    "make_run_id",
    "meets_quorum",
    "parse_scoped_id",
    "run_deliberation",
    "run_planning_deliberation",
    "run_quick_deliberation",
    "run_standard_deliberation",
    "scoped_id",
]

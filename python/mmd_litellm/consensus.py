from __future__ import annotations

from pydantic import BaseModel

from .schemas import Ballot, ConsensusLabel


class ConsensusThresholds(BaseModel):
    strong_approve_ratio: float = 1.0
    qualified_approve_ratio: float = 0.66
    reject_approve_ratio: float = 0.34


DEFAULT_CONSENSUS_THRESHOLDS = ConsensusThresholds()


class ClassifyCandidateResult(BaseModel):
    label: ConsensusLabel
    approve_ratio: float
    has_critical_objection: bool
    has_major_objection: bool
    partial: bool


def classify_candidate(
    ballots_for_candidate: list[Ballot],
    expected_voter_count: int,
    thresholds: ConsensusThresholds = DEFAULT_CONSENSUS_THRESHOLDS,
) -> ClassifyCandidateResult:
    if expected_voter_count <= 0:
        raise ValueError("expected_voter_count must be > 0")

    approve_count = sum(
        1
        for ballot in ballots_for_candidate
        if ballot.vote in ("approve", "approve_with_conditions")
    )
    approve_ratio = approve_count / expected_voter_count

    objections = [ballot for ballot in ballots_for_candidate if ballot.vote == "object"]
    has_critical_objection = any(
        ballot.objection_severity == "critical" for ballot in objections
    )
    has_major_objection = any(
        ballot.objection_severity == "major" for ballot in objections
    )
    partial = len(ballots_for_candidate) < expected_voter_count

    if has_critical_objection:
        label: ConsensusLabel = "disputed"
    elif has_major_objection:
        label = (
            "disputed"
            if approve_ratio >= thresholds.qualified_approve_ratio
            else "rejected"
        )
    elif approve_ratio >= thresholds.strong_approve_ratio:
        label = "strong_consensus"
    elif approve_ratio >= thresholds.qualified_approve_ratio:
        label = "qualified_consensus"
    elif approve_ratio <= thresholds.reject_approve_ratio:
        label = "rejected"
    else:
        label = "disputed"

    return ClassifyCandidateResult(
        label=label,
        approve_ratio=approve_ratio,
        has_critical_objection=has_critical_objection,
        has_major_objection=has_major_objection,
        partial=partial,
    )


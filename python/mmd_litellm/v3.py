from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .schemas import Ballot, ConsensusLabel

Governance = Literal["centralized", "distributed"]


class AlignmentPolicy(BaseModel):
    version: str = Field(min_length=1)
    minimum_pair_support: int = Field(ge=1)


class ExperimentManifest(BaseModel):
    experiment_id: str = Field(min_length=1)
    protocol_version: Literal["mmd.v3"] = "mmd.v3"
    alignment_policy: AlignmentPolicy | None = None


class ProtocolConfigurationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def resolve_governance(
    mode: Literal["quick", "standard", "planning"],
    governance: Governance | None,
    experiment_manifest: ExperimentManifest | None,
) -> Governance:
    resolved: Governance = governance or "centralized"
    if mode in ("quick", "planning") and resolved != "centralized":
        raise ProtocolConfigurationError(
            "invalid_governance",
            f"{mode} only supports centralized governance in mmd.v3",
        )
    if mode == "standard" and resolved == "distributed":
        if experiment_manifest is None or experiment_manifest.alignment_policy is None:
            raise ProtocolConfigurationError(
                "distributed_requires_manifest",
                "distributed Standard requires an mmd.v3 experiment manifest with alignment_policy",
            )
    return resolved


def validate_model_selection(
    mode: Literal["quick", "standard", "planning"],
    model_ids: list[str],
    coordinator_model: str | None,
) -> None:
    if len(set(model_ids)) != len(model_ids):
        raise ProtocolConfigurationError(
            "duplicate_models", "selected models must be distinct"
        )
    if mode == "quick" and len(model_ids) != 2:
        raise ProtocolConfigurationError(
            "quick_requires_two_models",
            "quick mode requires exactly two distinct models",
        )
    if coordinator_model is not None and coordinator_model not in model_ids:
        raise ProtocolConfigurationError(
            "coordinator_not_in_panel",
            "coordinator_model must be one of the explicitly selected models",
        )


class ClassificationBasis(BaseModel):
    candidate_set_id: str
    expected_voter_count: int
    ballots: list[Ballot]
    approve_ratio: float
    label: ConsensusLabel
    partial: bool


class TraceArtifact(BaseModel):
    artifact_id: str
    kind: str
    phase: str
    status: Literal["completed", "partial", "failed"]
    parent_ids: list[str] = Field(default_factory=list)
    topic_id: str | None = None
    candidate_set_id: str | None = None
    payload: Any


class TraceCall(BaseModel):
    call_id: str
    phase: str
    model_id: str
    role: Literal["panel", "coordinator", "host"]
    status: Literal["completed", "failed", "timeout"]
    attempt: int = 0
    topic_id: str | None = None
    usage: dict[str, Any] | None = None
    cost_usd: float | None = None
    latency_ms: float | None = None
    error_code: str | None = None


class TraceFailure(BaseModel):
    phase: str
    code: str
    message: str
    recoverable: bool
    topic_id: str | None = None
    model_id: str | None = None


class CandidateSetTrace(BaseModel):
    candidate_set_id: str
    governance: Governance
    topic_id: str | None = None
    candidate_ids: list[str]
    classification_basis: dict[str, ClassificationBasis]
    alignment: Any | None = None


class MmdTraceV3(BaseModel):
    trace_version: Literal["mmd.trace.v3"] = "mmd.trace.v3"
    protocol_version: Literal["mmd.v3"] = "mmd.v3"
    run_id: str
    mode: Literal["quick", "standard", "planning"]
    governance: Governance
    status: Literal["running", "completed", "partial", "failed"] = "running"
    versions: dict[str, str] = Field(
        default_factory=lambda: {
            "normalization": "normalize.v3",
            "alignment": "complete-link.v1",
            "decision_rule": "consensus.v1",
            "renderer": "canonical.v1",
        }
    )
    artifacts: list[TraceArtifact] = Field(default_factory=list)
    candidate_sets: list[CandidateSetTrace] = Field(default_factory=list)
    calls: list[TraceCall] = Field(default_factory=list)
    quorum: list[dict[str, Any]] = Field(default_factory=list)
    failures: list[TraceFailure] = Field(default_factory=list)
    extensions: dict[str, Any] = Field(default_factory=dict)
    usage: dict[str, int | float] = Field(
        default_factory=lambda: {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
            "usage_unavailable_count": 0,
        }
    )


class TraceRecorderV3:
    def __init__(self, run_id: str, mode: str, governance: Governance) -> None:
        self.trace = MmdTraceV3(run_id=run_id, mode=mode, governance=governance)  # type: ignore[arg-type]

    def add_artifact(self, artifact: TraceArtifact) -> None:
        if any(item.artifact_id == artifact.artifact_id for item in self.trace.artifacts):
            raise ValueError(f"duplicate artifact id: {artifact.artifact_id}")
        self.trace.artifacts.append(artifact)

    def add_failure(self, failure: TraceFailure) -> None:
        self.trace.failures.append(failure)

    def finish(self, status: Literal["completed", "partial", "failed"] | None = None) -> MmdTraceV3:
        self.trace.status = status or ("partial" if self.trace.failures else "completed")
        return self.trace

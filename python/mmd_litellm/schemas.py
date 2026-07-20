from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

ClaimType = Literal["fact", "judgment", "recommendation", "assumption", "risk"]
Stance = Literal["support", "challenge", "refine"]
Severity = Literal["minor", "major", "critical"]
RevisionDecision = Literal["keep", "revise", "withdraw", "adopt_other"]
VoteChoice = Literal["approve", "approve_with_conditions", "object", "abstain"]
ConsensusLabel = Literal[
    "strong_consensus", "qualified_consensus", "disputed", "rejected"
]
ConfidenceStrength = Literal["high", "medium", "low"]


class Claim(BaseModel):
    claim_id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    type: ClaimType
    confidence: float = Field(ge=0, le=1)
    rationale: str = Field(min_length=1)
    conditions: list[str] = Field(default_factory=list)
    topic_id: str | None = Field(default=None, min_length=1)


class Proposal(BaseModel):
    model_id: str = Field(min_length=1)
    answer_summary: str = Field(min_length=1)
    claims: list[Claim] = Field(min_length=1)
    assumptions: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)


class Review(BaseModel):
    target_claim_id: str = Field(min_length=1)
    stance: Stance
    severity: Severity
    comment: str = Field(min_length=1)
    suggested_revision: str | None = None


class Critique(BaseModel):
    reviewer_model_id: str = Field(min_length=1)
    reviews: list[Review] = Field(default_factory=list)


class Revision(BaseModel):
    original_claim_id: str = Field(min_length=1)
    decision: RevisionDecision
    revised_text: str | None = None
    confidence: float = Field(ge=0, le=1)
    reason_for_change: str = Field(min_length=1)
    influenced_by: list[str] = Field(default_factory=list)


class RevisionSet(BaseModel):
    model_id: str = Field(min_length=1)
    revisions: list[Revision] = Field(default_factory=list)


class CandidateClaim(BaseModel):
    candidate_id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    source_claim_ids: list[str] = Field(
        min_length=1,
        description="Every candidate must trace back to at least one source claim.",
    )
    notes: str | None = None
    topic_id: str | None = Field(default=None, min_length=1)


class NormalizeResult(BaseModel):
    candidate_claims: list[CandidateClaim] = Field(default_factory=list)


class Ballot(BaseModel):
    candidate_id: str = Field(min_length=1)
    vote: VoteChoice
    confidence: float = Field(ge=0, le=1)
    reason: str = Field(min_length=1)
    required_condition: str | None = None
    objection_severity: Severity | None = None

    @model_validator(mode="after")
    def object_votes_must_include_severity(self) -> Ballot:
        if self.vote == "object" and self.objection_severity is None:
            raise ValueError("object votes must include objection_severity")
        return self


class VoteSet(BaseModel):
    model_id: str = Field(min_length=1)
    votes: list[Ballot] = Field(default_factory=list)


class PositionChange(BaseModel):
    model_id: str = Field(min_length=1)
    changed_from: str
    changed_to: str
    reason: str


class ConfidenceSummary(BaseModel):
    consensus_strength: ConfidenceStrength
    notes: str


class FinalAnswer(BaseModel):
    final_answer: str = Field(min_length=1)
    strong_consensus: list[str] = Field(default_factory=list)
    qualified_consensus: list[str] = Field(default_factory=list)
    disputed_points: list[str] = Field(default_factory=list)
    rejected_or_unsupported: list[str] = Field(default_factory=list)
    model_position_changes: list[PositionChange] = Field(default_factory=list)
    confidence_summary: ConfidenceSummary


class Topic(BaseModel):
    topic_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)


class OutlineResult(BaseModel):
    topics: list[Topic] = Field(min_length=1, max_length=8)


class SectionAnswer(BaseModel):
    topic_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    tldr: str = Field(min_length=1)
    section_answer: str = Field(min_length=1)
    strong_consensus: list[str] = Field(default_factory=list)
    qualified_consensus: list[str] = Field(default_factory=list)
    disputed_points: list[str] = Field(default_factory=list)
    rejected_or_unsupported: list[str] = Field(default_factory=list)
    model_position_changes: list[PositionChange] = Field(default_factory=list)
    confidence_summary: ConfidenceSummary


class PlanDocument(BaseModel):
    executive_summary: str = Field(min_length=1)
    sections: list[SectionAnswer] = Field(min_length=1)


AlignmentRelation = Literal["equivalent", "distinct", "conflict", "uncertain"]


class AlignmentJudgment(BaseModel):
    left_claim_id: str = Field(min_length=1)
    right_claim_id: str = Field(min_length=1)
    relation: AlignmentRelation
    preferred_source_claim_id: str | None = None
    cannot_link: bool = False
    confidence: float = Field(ge=0, le=1)
    reason: str = Field(min_length=1)


class AlignResult(BaseModel):
    aligner_model_id: str = Field(min_length=1)
    judgments: list[AlignmentJudgment] = Field(default_factory=list)


class GlobalComposeCandidate(BaseModel):
    topic_id: str = Field(min_length=1)
    candidate_id: str = Field(min_length=1)
    classification: ConsensusLabel
    text: str = Field(min_length=1)


class PlanningOutputSpan(BaseModel):
    span_id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    source_candidate_ids: list[str] = Field(default_factory=list)
    lineage_kind: Literal["candidate", "coordinator_synthesis"]
    derived_from_candidate_ids: list[str] = Field(default_factory=list)


class PlanningOmission(BaseModel):
    candidate_id: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class PlanningFinalAnswer(BaseModel):
    final_answer: str = Field(min_length=1)
    spans: list[PlanningOutputSpan] = Field(min_length=1)
    omitted_strong_candidate_reasons: list[PlanningOmission] = Field(
        default_factory=list
    )

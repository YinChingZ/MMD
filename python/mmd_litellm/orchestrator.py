from __future__ import annotations

import asyncio
from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel, Field, model_validator

from .client import CompletionOutput, TokenUsage, coerce_completion_output
from .consensus import ClassifyCandidateResult, classify_candidate
from .ids import make_run_id, scoped_id
from .prompts import (
    CompletionRequest,
    build_compose_prompt,
    build_critique_prompt,
    build_normalize_prompt,
    build_outline_prompt,
    build_propose_prompt,
    build_revise_prompt,
    build_section_compose_prompt,
    build_vote_prompt,
)
from .quorum import QuorumCheck, check_quorum
from .schemas import (
    Ballot,
    CandidateClaim,
    Critique,
    FinalAnswer,
    NormalizeResult,
    OutlineResult,
    PlanDocument,
    Proposal,
    RevisionSet,
    SectionAnswer,
    Topic,
    VoteSet,
)
from .structured import call_structured

T = TypeVar("T", bound=BaseModel)


class CompletionClient(Protocol):
    async def acomplete(
        self, model: str, request: CompletionRequest, *, timeout: float | None = None
    ) -> str | CompletionOutput:
        ...


class DeliberationConfig(BaseModel):
    question: str = Field(min_length=1)
    analysis_models: list[str] = Field(min_length=1)
    coordinator_model: str | None = None
    mmd_mode: Literal["quick", "standard", "planning"] = "quick"
    quorum_ratio: float = Field(default=0.66, gt=0, le=1)
    per_model_timeout: float | None = Field(default=40.0, gt=0)
    max_repair_attempts: int = Field(default=2, ge=0)
    max_topics: int = Field(default=8, ge=1, le=8)
    return_trace: bool = False

    @model_validator(mode="after")
    def reject_recursive_models(self) -> DeliberationConfig:
        configured = [*self.analysis_models]
        if self.coordinator_model:
            configured.append(self.coordinator_model)
        recursive = [
            model
            for model in configured
            if model == "mmd-fusion" or model.startswith("mmd/")
        ]
        if recursive:
            raise ValueError(
                "analysis/coordinator models must be real base models, not MMD aliases: "
                + ", ".join(recursive)
            )
        return self


class PhaseFailure(BaseModel):
    model_id: str
    message: str


class UsageEvent(BaseModel):
    call_index: int
    phase: str
    model_id: str
    topic_id: str | None = None
    usage: TokenUsage | None = None
    usage_unavailable: bool = False


class UsageSummary(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    usage_unavailable: bool = False
    usage_unavailable_count: int = 0
    events: list[UsageEvent] = Field(default_factory=list)

    def openai_usage(self) -> dict[str, int]:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
        }


class UsageTracker:
    def __init__(self) -> None:
        self.events: list[UsageEvent] = []

    def record(
        self,
        *,
        model: str,
        request: CompletionRequest,
        usage: TokenUsage | None,
    ) -> None:
        self.events.append(
            UsageEvent(
                call_index=len(self.events),
                phase=str(request.meta.get("phase", "unknown")),
                model_id=model,
                topic_id=request.meta.get("topic_id"),
                usage=usage,
                usage_unavailable=usage is None,
            )
        )

    def summary(self) -> UsageSummary:
        prompt_tokens = 0
        completion_tokens = 0
        total_tokens = 0
        usage_unavailable_count = 0
        for event in self.events:
            if event.usage is None:
                usage_unavailable_count += 1
                continue
            prompt_tokens += event.usage.prompt_tokens
            completion_tokens += event.usage.completion_tokens
            total_tokens += event.usage.total_tokens
        return UsageSummary(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            usage_unavailable=usage_unavailable_count > 0,
            usage_unavailable_count=usage_unavailable_count,
            events=list(self.events),
        )


class UsageCollectingClient:
    def __init__(self, client: CompletionClient, tracker: UsageTracker) -> None:
        self.client = client
        self.tracker = tracker

    async def acomplete(
        self, model: str, request: CompletionRequest, *, timeout: float | None = None
    ) -> str | CompletionOutput:
        output = await self.client.acomplete(model, request, timeout=timeout)
        completion = coerce_completion_output(output)
        self.tracker.record(model=model, request=request, usage=completion.usage)
        return output


class FanoutOutcome(BaseModel):
    proposals: list[Proposal]
    quorum: QuorumCheck
    failures: list[PhaseFailure]


class StructuredFanoutOutcome(BaseModel):
    values: list[Any]
    quorum: QuorumCheck
    failures: list[PhaseFailure]


class ResolvedClaim(BaseModel):
    claim_id: str
    text: str
    model_id: str


class TopicResult(BaseModel):
    topic: Topic
    proposals: list[Proposal]
    critiques: list[Critique]
    revisions: list[RevisionSet]
    normalize: NormalizeResult
    votes: list[VoteSet]
    classifications: dict[str, ClassifyCandidateResult]
    quorum: dict[str, QuorumCheck]
    failures: dict[str, list[PhaseFailure]] = Field(default_factory=dict)


class FailedTopic(BaseModel):
    topic: Topic
    error: str


class DeliberationResult(BaseModel):
    run_id: str
    question: str
    mode: Literal["quick", "standard", "planning"]
    proposals: list[Proposal]
    critiques: list[Critique] = Field(default_factory=list)
    revisions: list[RevisionSet] = Field(default_factory=list)
    normalize: NormalizeResult
    votes: list[VoteSet] = Field(default_factory=list)
    classifications: dict[str, ClassifyCandidateResult]
    final: FinalAnswer
    quorum: dict[str, QuorumCheck]
    failures: dict[str, list[PhaseFailure]] = Field(default_factory=dict)
    outline: OutlineResult | None = None
    topics: list[TopicResult] = Field(default_factory=list)
    failed_topics: list[FailedTopic] = Field(default_factory=list)
    plan_document: PlanDocument | None = None
    usage: UsageSummary = Field(default_factory=UsageSummary)

    def trace_payload(self) -> dict[str, Any]:
        payload = self.model_dump(mode="json", exclude={"final"}, exclude_none=True)
        return {
            "trace_version": 1,
            "protocol": "mmd.v1",
            **payload,
        }

    def response_content(self) -> str:
        if self.plan_document is None:
            return self.final.final_answer

        lines = [
            f"# Plan Document: {self.run_id}",
            "",
            f"Question: {self.question}",
            "",
            "## Executive Summary",
            "",
            self.plan_document.executive_summary,
            "",
        ]
        for section in self.plan_document.sections:
            lines.extend(
                [
                    f"## {section.title}",
                    "",
                    section.section_answer,
                    "",
                ]
            )
            _append_markdown_list(lines, "Strong consensus", section.strong_consensus)
            _append_markdown_list(
                lines, "Qualified consensus", section.qualified_consensus
            )
            _append_markdown_list(lines, "Disputed", section.disputed_points)
            _append_markdown_list(
                lines, "Rejected / unsupported", section.rejected_or_unsupported
            )
        return "\n".join(lines).strip()


def _append_markdown_list(lines: list[str], title: str, values: list[str]) -> None:
    if not values:
        return
    lines.append(f"### {title}")
    lines.append("")
    for value in values:
        lines.append(f"- {value}")
    lines.append("")


class QuorumNotMetError(RuntimeError):
    def __init__(
        self,
        phase: str,
        quorum: QuorumCheck,
        failures: list[PhaseFailure],
    ) -> None:
        detail = " | ".join(f"{f.model_id}: {f.message}" for f in failures)
        message = (
            f'phase "{phase}" did not meet quorum: '
            f"{quorum.respondent_count}/{quorum.required} required responses"
        )
        if detail:
            message += f" - failures: {detail}"
        super().__init__(message)
        self.phase = phase
        self.quorum = quorum
        self.failures = failures


async def _call_model_structured(
    *,
    client: CompletionClient,
    model: str,
    request: CompletionRequest,
    schema: type[T],
    timeout: float | None,
    max_repair_attempts: int,
) -> T:
    async def complete(repair_note: str | None) -> str:
        next_request = request
        if repair_note:
            next_request = request.model_copy(
                update={"user_prompt": f"{request.user_prompt}\n\n{repair_note}"}
            )
        output = await client.acomplete(model, next_request, timeout=timeout)
        return coerce_completion_output(output).text

    return await call_structured(
        complete, schema, max_repair_attempts=max_repair_attempts
    )


def _stamp_proposal(
    run_id: str, model_id: str, proposal: Proposal, topic_id: str | None = None
) -> Proposal:
    claims = []
    for index, claim in enumerate(proposal.claims):
        local_id = f"{model_id}::c{index}"
        if topic_id:
            local_id = f"{topic_id}::{local_id}"
        claims.append(
            claim.model_copy(
                update={
                    "claim_id": scoped_id(run_id, local_id),
                    "topic_id": topic_id,
                }
            )
        )
    return proposal.model_copy(update={"model_id": model_id, "claims": claims})


def _stamp_critique(model_id: str, critique: Critique) -> Critique:
    return critique.model_copy(update={"reviewer_model_id": model_id})


def _stamp_revision_set(model_id: str, revision_set: RevisionSet) -> RevisionSet:
    return revision_set.model_copy(update={"model_id": model_id})


def _stamp_vote_set(model_id: str, vote_set: VoteSet) -> VoteSet:
    return vote_set.model_copy(update={"model_id": model_id})


def _stamp_section_answer(topic: Topic, section: SectionAnswer) -> SectionAnswer:
    return section.model_copy(update={"topic_id": topic.topic_id, "title": topic.title})


async def _fanout_propose(
    *,
    client: CompletionClient,
    config: DeliberationConfig,
    run_id: str,
    topic: Topic | None = None,
) -> FanoutOutcome:
    async def call_one(model: str) -> tuple[str, Proposal | Exception]:
        try:
            request = build_propose_prompt(
                question=config.question, model_id=model, topic=topic
            )
            proposal = await _call_model_structured(
                client=client,
                model=model,
                request=request,
                schema=Proposal,
                timeout=config.per_model_timeout,
                max_repair_attempts=config.max_repair_attempts,
            )
            return model, _stamp_proposal(
                run_id, model, proposal, topic.topic_id if topic else None
            )
        except Exception as error:  # fan-out records per-model failures
            return model, error

    results = await asyncio.gather(
        *(call_one(model) for model in config.analysis_models)
    )
    proposals: list[Proposal] = []
    failures: list[PhaseFailure] = []
    for model, result in results:
        if isinstance(result, Exception):
            failures.append(PhaseFailure(model_id=model, message=str(result)))
        else:
            proposals.append(result)

    quorum = check_quorum(
        len(proposals), len(config.analysis_models), config.quorum_ratio
    )
    return FanoutOutcome(proposals=proposals, quorum=quorum, failures=failures)


async def _fanout_structured(
    *,
    client: CompletionClient,
    config: DeliberationConfig,
    schema: type[T],
    build_request,
    stamp,
) -> StructuredFanoutOutcome:
    async def call_one(model: str) -> tuple[str, T | Exception]:
        try:
            value = await _call_model_structured(
                client=client,
                model=model,
                request=build_request(model),
                schema=schema,
                timeout=config.per_model_timeout,
                max_repair_attempts=config.max_repair_attempts,
            )
            return model, stamp(model, value)
        except Exception as error:  # fan-out records per-model failures
            return model, error

    results = await asyncio.gather(
        *(call_one(model) for model in config.analysis_models)
    )
    values: list[Any] = []
    failures: list[PhaseFailure] = []
    for model, result in results:
        if isinstance(result, Exception):
            failures.append(PhaseFailure(model_id=model, message=str(result)))
        else:
            values.append(result)

    quorum = check_quorum(len(values), len(config.analysis_models), config.quorum_ratio)
    return StructuredFanoutOutcome(values=values, quorum=quorum, failures=failures)


def _resolved_claims(
    proposals: list[Proposal], revisions: list[RevisionSet] | None = None
) -> list[ResolvedClaim]:
    revision_by_claim_id = {
        revision.original_claim_id: revision
        for revision_set in revisions or []
        for revision in revision_set.revisions
    }
    resolved: list[ResolvedClaim] = []
    for proposal in proposals:
        for claim in proposal.claims:
            revision = revision_by_claim_id.get(claim.claim_id)
            if revision and revision.decision == "withdraw":
                continue
            resolved.append(
                ResolvedClaim(
                    claim_id=claim.claim_id,
                    text=(
                        revision.revised_text
                        if revision and revision.revised_text
                        else claim.text
                    ),
                    model_id=proposal.model_id,
                )
            )
    return resolved


def _reviews_for_model(
    model_id: str, proposals: list[Proposal], critiques: list[Critique]
) -> list[dict[str, Any]]:
    own_claim_ids = {
        claim.claim_id
        for proposal in proposals
        if proposal.model_id == model_id
        for claim in proposal.claims
    }
    reviews: list[dict[str, Any]] = []
    for critique in critiques:
        for review in critique.reviews:
            if review.target_claim_id in own_claim_ids:
                payload = review.model_dump()
                payload["reviewer_model_id"] = critique.reviewer_model_id
                reviews.append(payload)
    return reviews


def _own_claims_for_model(
    model_id: str, proposals: list[Proposal]
) -> list[dict[str, Any]]:
    for proposal in proposals:
        if proposal.model_id == model_id:
            return [claim.model_dump(mode="json") for claim in proposal.claims]
    return []


def _position_changes(
    proposals: list[Proposal], revisions: list[RevisionSet]
) -> list[dict[str, str]]:
    original_by_model_and_claim = {
        (proposal.model_id, claim.claim_id): claim.text
        for proposal in proposals
        for claim in proposal.claims
    }
    changes: list[dict[str, str]] = []
    for revision_set in revisions:
        for revision in revision_set.revisions:
            if revision.decision == "keep":
                continue
            original = original_by_model_and_claim.get(
                (revision_set.model_id, revision.original_claim_id),
                revision.original_claim_id,
            )
            changed_to = revision.revised_text
            if changed_to is None:
                changed_to = (
                    "(withdrawn)"
                    if revision.decision == "withdraw"
                    else "(adopted another model's claim)"
                )
            changes.append(
                {
                    "model_id": revision_set.model_id,
                    "changed_from": original,
                    "changed_to": changed_to,
                    "reason": revision.reason_for_change,
                }
            )
    return changes


def _ballots_by_candidate(votes: list[VoteSet]) -> dict[str, list[Ballot]]:
    ballots: dict[str, list[Ballot]] = {}
    for vote_set in votes:
        for ballot in vote_set.votes:
            ballots.setdefault(ballot.candidate_id, []).append(ballot)
    return ballots


def _implied_ballots_from_coverage(
    candidate: CandidateClaim,
    claims_by_id: dict[str, ResolvedClaim],
) -> list[Ballot]:
    distinct_models = {
        claims_by_id[source_id].model_id
        for source_id in candidate.source_claim_ids
        if source_id in claims_by_id
    }
    return [
        Ballot(
            candidate_id=candidate.candidate_id,
            vote="approve",
            confidence=1,
            reason=(
                "implied by independent proposal overlap from "
                f"{model_id} (quick mode, no explicit vote)"
            ),
        )
        for model_id in sorted(distinct_models)
    ]


def _consensus_buckets(
    normalize: NormalizeResult,
    classifications: dict[str, ClassifyCandidateResult],
) -> tuple[list[str], list[str], list[str], list[str]]:
    strong: list[str] = []
    qualified: list[str] = []
    disputed: list[str] = []
    rejected: list[str] = []
    for candidate in normalize.candidate_claims:
        label = classifications[candidate.candidate_id].label
        if label == "strong_consensus":
            strong.append(candidate.text)
        elif label == "qualified_consensus":
            qualified.append(candidate.text)
        elif label == "disputed":
            disputed.append(candidate.text)
        else:
            rejected.append(candidate.text)
    return strong, qualified, disputed, rejected


async def run_quick_deliberation(
    config: DeliberationConfig, client: CompletionClient
) -> DeliberationResult:
    if config.mmd_mode != "quick":
        raise NotImplementedError("only quick mode is implemented in this PoC")

    usage_tracker = UsageTracker()
    client = UsageCollectingClient(client, usage_tracker)
    run_id = make_run_id()
    coordinator = config.coordinator_model or config.analysis_models[0]

    propose_outcome = await _fanout_propose(
        client=client,
        config=config,
        run_id=run_id,
    )
    if not propose_outcome.quorum.met:
        raise QuorumNotMetError(
            "propose", propose_outcome.quorum, propose_outcome.failures
        )

    claims = _resolved_claims(propose_outcome.proposals)
    claim_payload = [claim.model_dump() for claim in claims]
    normalize = await _call_model_structured(
        client=client,
        model=coordinator,
        request=build_normalize_prompt(
            question=config.question,
            claims=claim_payload,
        ),
        schema=NormalizeResult,
        timeout=config.per_model_timeout,
        max_repair_attempts=config.max_repair_attempts,
    )

    claims_by_id = {claim.claim_id: claim for claim in claims}
    classifications: dict[str, ClassifyCandidateResult] = {}
    for candidate in normalize.candidate_claims:
        ballots = _implied_ballots_from_coverage(candidate, claims_by_id)
        classifications[candidate.candidate_id] = classify_candidate(
            ballots,
            expected_voter_count=len(config.analysis_models),
        )

    strong, qualified, disputed, rejected = _consensus_buckets(
        normalize, classifications
    )
    final = await _call_model_structured(
        client=client,
        model=coordinator,
        request=build_compose_prompt(
            question=config.question,
            strong_consensus=strong,
            qualified_consensus=qualified,
            disputed=disputed,
            rejected=rejected,
            position_changes=[],
        ),
        schema=FinalAnswer,
        timeout=config.per_model_timeout,
        max_repair_attempts=config.max_repair_attempts,
    )

    return DeliberationResult(
        run_id=run_id,
        question=config.question,
        mode="quick",
        proposals=propose_outcome.proposals,
        normalize=normalize,
        classifications=classifications,
        final=final,
        quorum={"propose": propose_outcome.quorum},
        failures={"propose": propose_outcome.failures},
        usage=usage_tracker.summary(),
    )


async def run_standard_deliberation(
    config: DeliberationConfig, client: CompletionClient
) -> DeliberationResult:
    if config.mmd_mode != "standard":
        raise ValueError("run_standard_deliberation requires mmd_mode='standard'")

    usage_tracker = UsageTracker()
    client = UsageCollectingClient(client, usage_tracker)
    run_id = make_run_id()
    coordinator = config.coordinator_model or config.analysis_models[0]
    quorum: dict[str, QuorumCheck] = {}
    failures: dict[str, list[PhaseFailure]] = {}

    propose_outcome = await _fanout_propose(
        client=client,
        config=config,
        run_id=run_id,
    )
    quorum["propose"] = propose_outcome.quorum
    failures["propose"] = propose_outcome.failures
    if not propose_outcome.quorum.met:
        raise QuorumNotMetError(
            "propose", propose_outcome.quorum, propose_outcome.failures
        )

    critique_outcome = await _fanout_structured(
        client=client,
        config=config,
        schema=Critique,
        build_request=lambda model: build_critique_prompt(
            question=config.question,
            reviewer_model_id=model,
            proposals=propose_outcome.proposals,
        ),
        stamp=_stamp_critique,
    )
    critiques = [
        value for value in critique_outcome.values if isinstance(value, Critique)
    ]
    quorum["critique"] = critique_outcome.quorum
    failures["critique"] = critique_outcome.failures
    if not critique_outcome.quorum.met:
        raise QuorumNotMetError(
            "critique", critique_outcome.quorum, critique_outcome.failures
        )

    revise_outcome = await _fanout_structured(
        client=client,
        config=config,
        schema=RevisionSet,
        build_request=lambda model: build_revise_prompt(
            question=config.question,
            model_id=model,
            own_claims=_own_claims_for_model(model, propose_outcome.proposals),
            reviews_on_mine=_reviews_for_model(
                model, propose_outcome.proposals, critiques
            ),
        ),
        stamp=_stamp_revision_set,
    )
    revisions = [
        value for value in revise_outcome.values if isinstance(value, RevisionSet)
    ]
    quorum["revise"] = revise_outcome.quorum
    failures["revise"] = revise_outcome.failures
    if not revise_outcome.quorum.met:
        raise QuorumNotMetError(
            "revise", revise_outcome.quorum, revise_outcome.failures
        )

    claims = _resolved_claims(propose_outcome.proposals, revisions)
    claim_payload = [claim.model_dump() for claim in claims]
    normalize = await _call_model_structured(
        client=client,
        model=coordinator,
        request=build_normalize_prompt(
            question=config.question,
            claims=claim_payload,
        ),
        schema=NormalizeResult,
        timeout=config.per_model_timeout,
        max_repair_attempts=config.max_repair_attempts,
    )

    vote_outcome = await _fanout_structured(
        client=client,
        config=config,
        schema=VoteSet,
        build_request=lambda model: build_vote_prompt(
            question=config.question,
            model_id=model,
            candidates=[
                {"candidate_id": candidate.candidate_id, "text": candidate.text}
                for candidate in normalize.candidate_claims
            ],
        ),
        stamp=_stamp_vote_set,
    )
    votes = [value for value in vote_outcome.values if isinstance(value, VoteSet)]
    quorum["vote"] = vote_outcome.quorum
    failures["vote"] = vote_outcome.failures
    if not vote_outcome.quorum.met:
        raise QuorumNotMetError("vote", vote_outcome.quorum, vote_outcome.failures)

    ballot_map = _ballots_by_candidate(votes)
    classifications: dict[str, ClassifyCandidateResult] = {}
    for candidate in normalize.candidate_claims:
        classifications[candidate.candidate_id] = classify_candidate(
            ballot_map.get(candidate.candidate_id, []),
            expected_voter_count=len(config.analysis_models),
        )

    strong, qualified, disputed, rejected = _consensus_buckets(
        normalize, classifications
    )
    final = await _call_model_structured(
        client=client,
        model=coordinator,
        request=build_compose_prompt(
            question=config.question,
            strong_consensus=strong,
            qualified_consensus=qualified,
            disputed=disputed,
            rejected=rejected,
            position_changes=_position_changes(propose_outcome.proposals, revisions),
        ),
        schema=FinalAnswer,
        timeout=config.per_model_timeout,
        max_repair_attempts=config.max_repair_attempts,
    )

    return DeliberationResult(
        run_id=run_id,
        question=config.question,
        mode="standard",
        proposals=propose_outcome.proposals,
        critiques=critiques,
        revisions=revisions,
        normalize=normalize,
        votes=votes,
        classifications=classifications,
        final=final,
        quorum=quorum,
        failures=failures,
        usage=usage_tracker.summary(),
    )


async def _run_topic_deliberation(
    *,
    run_id: str,
    config: DeliberationConfig,
    client: CompletionClient,
    topic: Topic,
) -> TopicResult:
    coordinator = config.coordinator_model or config.analysis_models[0]
    quorum: dict[str, QuorumCheck] = {}
    failures: dict[str, list[PhaseFailure]] = {}

    propose_outcome = await _fanout_propose(
        client=client,
        config=config,
        run_id=run_id,
        topic=topic,
    )
    quorum["propose"] = propose_outcome.quorum
    failures["propose"] = propose_outcome.failures
    if not propose_outcome.quorum.met:
        raise QuorumNotMetError(
            "propose", propose_outcome.quorum, propose_outcome.failures
        )

    critique_outcome = await _fanout_structured(
        client=client,
        config=config,
        schema=Critique,
        build_request=lambda model: build_critique_prompt(
            question=config.question,
            reviewer_model_id=model,
            proposals=propose_outcome.proposals,
            topic=topic,
        ),
        stamp=_stamp_critique,
    )
    critiques = [
        value for value in critique_outcome.values if isinstance(value, Critique)
    ]
    quorum["critique"] = critique_outcome.quorum
    failures["critique"] = critique_outcome.failures
    if not critique_outcome.quorum.met:
        raise QuorumNotMetError(
            "critique", critique_outcome.quorum, critique_outcome.failures
        )

    revise_outcome = await _fanout_structured(
        client=client,
        config=config,
        schema=RevisionSet,
        build_request=lambda model: build_revise_prompt(
            question=config.question,
            model_id=model,
            own_claims=_own_claims_for_model(model, propose_outcome.proposals),
            reviews_on_mine=_reviews_for_model(
                model, propose_outcome.proposals, critiques
            ),
        ),
        stamp=_stamp_revision_set,
    )
    revisions = [
        value for value in revise_outcome.values if isinstance(value, RevisionSet)
    ]
    quorum["revise"] = revise_outcome.quorum
    failures["revise"] = revise_outcome.failures
    if not revise_outcome.quorum.met:
        raise QuorumNotMetError(
            "revise", revise_outcome.quorum, revise_outcome.failures
        )

    claims = _resolved_claims(propose_outcome.proposals, revisions)
    claim_payload = [claim.model_dump() for claim in claims]
    normalize = await _call_model_structured(
        client=client,
        model=coordinator,
        request=build_normalize_prompt(
            question=config.question,
            claims=claim_payload,
            topic=topic,
        ),
        schema=NormalizeResult,
        timeout=config.per_model_timeout,
        max_repair_attempts=config.max_repair_attempts,
    )

    vote_outcome = await _fanout_structured(
        client=client,
        config=config,
        schema=VoteSet,
        build_request=lambda model: build_vote_prompt(
            question=config.question,
            model_id=model,
            candidates=[
                {"candidate_id": candidate.candidate_id, "text": candidate.text}
                for candidate in normalize.candidate_claims
            ],
        ),
        stamp=_stamp_vote_set,
    )
    votes = [value for value in vote_outcome.values if isinstance(value, VoteSet)]
    quorum["vote"] = vote_outcome.quorum
    failures["vote"] = vote_outcome.failures
    if not vote_outcome.quorum.met:
        raise QuorumNotMetError("vote", vote_outcome.quorum, vote_outcome.failures)

    ballot_map = _ballots_by_candidate(votes)
    classifications: dict[str, ClassifyCandidateResult] = {}
    for candidate in normalize.candidate_claims:
        classifications[candidate.candidate_id] = classify_candidate(
            ballot_map.get(candidate.candidate_id, []),
            expected_voter_count=len(config.analysis_models),
        )

    return TopicResult(
        topic=topic,
        proposals=propose_outcome.proposals,
        critiques=critiques,
        revisions=revisions,
        normalize=normalize,
        votes=votes,
        classifications=classifications,
        quorum=quorum,
        failures=failures,
    )


async def run_planning_deliberation(
    config: DeliberationConfig, client: CompletionClient
) -> DeliberationResult:
    if config.mmd_mode != "planning":
        raise ValueError("run_planning_deliberation requires mmd_mode='planning'")

    usage_tracker = UsageTracker()
    client = UsageCollectingClient(client, usage_tracker)
    run_id = make_run_id()
    coordinator = config.coordinator_model or config.analysis_models[0]

    outline = await _call_model_structured(
        client=client,
        model=coordinator,
        request=build_outline_prompt(
            question=config.question,
            max_topics=config.max_topics,
        ),
        schema=OutlineResult,
        timeout=config.per_model_timeout,
        max_repair_attempts=config.max_repair_attempts,
    )

    topic_outcomes = await asyncio.gather(
        *(
            _run_topic_deliberation(
                run_id=run_id,
                config=config,
                client=client,
                topic=topic,
            )
            for topic in outline.topics
        ),
        return_exceptions=True,
    )

    topics: list[TopicResult] = []
    failed_topics: list[FailedTopic] = []
    for topic, outcome in zip(outline.topics, topic_outcomes):
        if isinstance(outcome, Exception):
            failed_topics.append(FailedTopic(topic=topic, error=str(outcome)))
        else:
            topics.append(outcome)

    if not topics:
        detail = " | ".join(
            f"{failed.topic.topic_id}: {failed.error}" for failed in failed_topics
        )
        raise RuntimeError(
            f"planning mode: all {len(outline.topics)} topic(s) failed - {detail}"
        )

    async def compose_section(topic_result: TopicResult) -> SectionAnswer:
        strong, qualified, disputed, rejected = _consensus_buckets(
            topic_result.normalize, topic_result.classifications
        )
        section = await _call_model_structured(
            client=client,
            model=coordinator,
            request=build_section_compose_prompt(
                question=config.question,
                topic=topic_result.topic,
                strong_consensus=strong,
                qualified_consensus=qualified,
                disputed=disputed,
                rejected=rejected,
                position_changes=_position_changes(
                    topic_result.proposals, topic_result.revisions
                ),
            ),
            schema=SectionAnswer,
            timeout=config.per_model_timeout,
            max_repair_attempts=config.max_repair_attempts,
        )
        return _stamp_section_answer(topic_result.topic, section)

    sections = await asyncio.gather(*(compose_section(topic) for topic in topics))
    executive_summary = "\n".join(section.tldr for section in sections)
    plan_document = PlanDocument(
        executive_summary=executive_summary,
        sections=list(sections),
    )
    final = FinalAnswer(
        final_answer=executive_summary,
        strong_consensus=[],
        qualified_consensus=[],
        disputed_points=[],
        rejected_or_unsupported=[],
        model_position_changes=[],
        confidence_summary={
            "consensus_strength": "medium",
            "notes": "See plan_document for per-section detail.",
        },
    )

    return DeliberationResult(
        run_id=run_id,
        question=config.question,
        mode="planning",
        proposals=[],
        normalize=NormalizeResult(candidate_claims=[]),
        classifications={},
        final=final,
        quorum={},
        failures={},
        outline=outline,
        topics=topics,
        failed_topics=failed_topics,
        plan_document=plan_document,
        usage=usage_tracker.summary(),
    )


async def run_deliberation(
    config: DeliberationConfig, client: CompletionClient
) -> DeliberationResult:
    if config.mmd_mode == "quick":
        return await run_quick_deliberation(config, client)
    if config.mmd_mode == "standard":
        return await run_standard_deliberation(config, client)
    if config.mmd_mode == "planning":
        return await run_planning_deliberation(config, client)
    raise NotImplementedError(f"unsupported mmd_mode: {config.mmd_mode}")

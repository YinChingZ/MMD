from __future__ import annotations

import asyncio
from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel, Field, model_validator

from .consensus import ClassifyCandidateResult, classify_candidate
from .ids import make_run_id, scoped_id
from .prompts import (
    CompletionRequest,
    build_compose_prompt,
    build_normalize_prompt,
    build_propose_prompt,
)
from .quorum import QuorumCheck, check_quorum
from .schemas import (
    Ballot,
    CandidateClaim,
    FinalAnswer,
    NormalizeResult,
    Proposal,
)
from .structured import call_structured

T = TypeVar("T", bound=BaseModel)


class CompletionClient(Protocol):
    async def acomplete(
        self, model: str, request: CompletionRequest, *, timeout: float | None = None
    ) -> str:
        ...


class DeliberationConfig(BaseModel):
    question: str = Field(min_length=1)
    analysis_models: list[str] = Field(min_length=1)
    coordinator_model: str | None = None
    mmd_mode: Literal["quick", "standard"] = "quick"
    quorum_ratio: float = Field(default=0.66, gt=0, le=1)
    per_model_timeout: float | None = Field(default=40.0, gt=0)
    max_repair_attempts: int = Field(default=2, ge=0)
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


class FanoutOutcome(BaseModel):
    proposals: list[Proposal]
    quorum: QuorumCheck
    failures: list[PhaseFailure]


class ResolvedClaim(BaseModel):
    claim_id: str
    text: str
    model_id: str


class DeliberationResult(BaseModel):
    run_id: str
    question: str
    mode: Literal["quick"]
    proposals: list[Proposal]
    normalize: NormalizeResult
    classifications: dict[str, ClassifyCandidateResult]
    final: FinalAnswer
    quorum: dict[str, QuorumCheck]
    failures: dict[str, list[PhaseFailure]] = Field(default_factory=dict)

    def trace_payload(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude={"final"})


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
        return await client.acomplete(model, next_request, timeout=timeout)

    return await call_structured(
        complete, schema, max_repair_attempts=max_repair_attempts
    )


def _stamp_proposal(run_id: str, model_id: str, proposal: Proposal) -> Proposal:
    claims = []
    for index, claim in enumerate(proposal.claims):
        claims.append(
            claim.model_copy(
                update={
                    "claim_id": scoped_id(run_id, f"{model_id}::c{index}"),
                    "topic_id": None,
                }
            )
        )
    return proposal.model_copy(update={"model_id": model_id, "claims": claims})


async def _fanout_propose(
    *,
    client: CompletionClient,
    config: DeliberationConfig,
    run_id: str,
) -> FanoutOutcome:
    async def call_one(model: str) -> tuple[str, Proposal | Exception]:
        try:
            request = build_propose_prompt(question=config.question, model_id=model)
            proposal = await _call_model_structured(
                client=client,
                model=model,
                request=request,
                schema=Proposal,
                timeout=config.per_model_timeout,
                max_repair_attempts=config.max_repair_attempts,
            )
            return model, _stamp_proposal(run_id, model, proposal)
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


def _resolved_claims(proposals: list[Proposal]) -> list[ResolvedClaim]:
    return [
        ResolvedClaim(
            claim_id=claim.claim_id,
            text=claim.text,
            model_id=proposal.model_id,
        )
        for proposal in proposals
        for claim in proposal.claims
    ]


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
    )

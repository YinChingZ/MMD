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
MMDMode = Literal["quick", "standard", "planning"]
PresetName = Literal["cheap", "balanced", "strong"]
PANEL_PHASES = {"propose", "critique", "revise", "vote"}
MODE_TIMEOUT_DEFAULTS: dict[str, float] = {
    "quick": 40.0,
    "standard": 90.0,
    "planning": 120.0,
}
PRESET_DEFAULTS: dict[str, dict[str, Any]] = {
    "cheap": {
        "max_analysis_models": 2,
        "per_model_timeout": 30.0,
    },
    "balanced": {
        "max_analysis_models": 3,
        "per_model_timeout": 60.0,
    },
    "strong": {
        "max_analysis_models": 5,
        "per_model_timeout": 120.0,
    },
}


class CompletionClient(Protocol):
    async def acomplete(
        self, model: str, request: CompletionRequest, *, timeout: float | None = None
    ) -> str | CompletionOutput:
        ...


class DeliberationConfig(BaseModel):
    question: str = Field(min_length=1)
    analysis_models: list[str] = Field(min_length=1)
    coordinator_model: str | None = None
    preset: PresetName | None = None
    mmd_mode: MMDMode = "quick"
    quorum_ratio: float = Field(default=0.66, gt=0, le=1)
    per_model_timeout: float | None = Field(default=None, gt=0)
    max_run_timeout: float | None = Field(default=None, gt=0)
    max_total_calls: int | None = Field(default=None, ge=1)
    max_log_trace_candidates: int = Field(default=50, ge=0)
    max_repair_attempts: int = Field(default=2, ge=0)
    max_topics: int = Field(default=8, ge=1, le=8)
    max_analysis_models: int = Field(default=8, ge=1, le=8)
    max_completion_tokens: int | None = Field(default=None, gt=0)
    temperature: float | None = Field(default=None, ge=0, le=2)
    coordinator_temperature: float | None = Field(default=0.1, ge=0, le=2)
    reasoning: Any | None = None
    tools: list[dict[str, Any]] = Field(default_factory=list)
    tool_choice: Any | None = None
    max_tool_calls: int | None = Field(default=None, ge=0)
    coordinator_tools_enabled: bool = False
    model_params: dict[str, Any] = Field(default_factory=dict)
    analysis_model_params: dict[str, Any] = Field(default_factory=dict)
    coordinator_model_params: dict[str, Any] = Field(default_factory=dict)
    return_trace: bool = False

    @model_validator(mode="before")
    @classmethod
    def apply_advanced_config_defaults(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        values = dict(data)
        preset = values.get("preset")
        preset_defaults = PRESET_DEFAULTS.get(preset, {})
        for key, value in preset_defaults.items():
            if values.get(key) is None:
                values[key] = value
        if values.get("max_analysis_models") is None:
            values.pop("max_analysis_models", None)

        mode = values.get("mmd_mode") or "quick"
        if values.get("per_model_timeout") is None:
            values["per_model_timeout"] = MODE_TIMEOUT_DEFAULTS.get(
                mode, MODE_TIMEOUT_DEFAULTS["quick"]
            )
        return values

    @model_validator(mode="after")
    def validate_and_limit_models(self) -> DeliberationConfig:
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
        if len(self.analysis_models) > self.max_analysis_models:
            self.analysis_models = self.analysis_models[: self.max_analysis_models]
        return self

    def call_params_for_phase(self, phase: str) -> dict[str, Any]:
        params = dict(self.model_params)
        if self.max_completion_tokens is not None:
            params["max_completion_tokens"] = self.max_completion_tokens
        if self.reasoning is not None:
            params["reasoning"] = self.reasoning

        if phase in PANEL_PHASES:
            if self.temperature is not None:
                params["temperature"] = self.temperature
            params.update(self.analysis_model_params)
        else:
            if self.coordinator_temperature is not None:
                params["temperature"] = self.coordinator_temperature
            params.update(self.coordinator_model_params)

        if self.tools and (
            phase in PANEL_PHASES or self.coordinator_tools_enabled
        ):
            params["tools"] = self.tools
            if self.tool_choice is not None:
                params["tool_choice"] = self.tool_choice
            if self.max_tool_calls is not None:
                params["max_tool_calls"] = self.max_tool_calls

        return {key: value for key, value in params.items() if value is not None}

    def tool_trace_info(self) -> ToolTraceInfo:
        return ToolTraceInfo(
            enabled_for_panel=bool(self.tools),
            enabled_for_coordinator=bool(
                self.tools and self.coordinator_tools_enabled
            ),
            tool_count=len(self.tools),
            tool_choice=self.tool_choice,
            max_tool_calls=self.max_tool_calls,
        )


class PhaseFailure(BaseModel):
    model_id: str
    message: str


class ToolTraceInfo(BaseModel):
    enabled_for_panel: bool = False
    enabled_for_coordinator: bool = False
    tool_count: int = 0
    tool_choice: Any | None = None
    max_tool_calls: int | None = None


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


class CallLimitedClient:
    """Shares one strict model-call budget across every phase and topic."""

    def __init__(self, client: CompletionClient, max_total_calls: int) -> None:
        self.client = client
        self.max_total_calls = max_total_calls
        self.calls_started = 0

    async def acomplete(
        self, model: str, request: CompletionRequest, *, timeout: float | None = None
    ) -> str | CompletionOutput:
        if self.calls_started >= self.max_total_calls:
            raise CallBudgetExceededError(self.max_total_calls)
        self.calls_started += 1
        return await self.client.acomplete(model, request, timeout=timeout)


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
    mode: MMDMode
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
    tooling: ToolTraceInfo = Field(default_factory=ToolTraceInfo)

    def trace_payload(self) -> dict[str, Any]:
        payload = self.model_dump(mode="json", exclude={"final"}, exclude_none=True)
        return {
            "trace_version": 1,
            "protocol": "mmd.v1",
            **payload,
        }

    def logging_trace_payload(
        self, *, max_candidates: int | None = None
    ) -> dict[str, Any]:
        candidate_claims, omitted_candidates = _logging_candidates(
            self.normalize.candidate_claims, max_candidates
        )
        payload = {
            "trace_version": 1,
            "protocol": "mmd.v1",
            "run_id": self.run_id,
            "mode": self.mode,
            "quorum": {
                phase: quorum.model_dump(mode="json")
                for phase, quorum in self.quorum.items()
            },
            "classifications": {
                candidate_id: classification.model_dump(mode="json")
                for candidate_id, classification in self.classifications.items()
            },
            "candidate_claims": candidate_claims,
            "failures": {
                phase: [failure.model_dump(mode="json") for failure in failures]
                for phase, failures in self.failures.items()
            },
            "usage": self.usage.model_dump(mode="json"),
            "tooling": self.tooling.model_dump(mode="json", exclude_none=True),
        }
        omitted_topic_candidates = 0
        if self.topics:
            topic_payloads = []
            for topic_result in self.topics:
                topic_candidates, omitted = _logging_candidates(
                    topic_result.normalize.candidate_claims, max_candidates
                )
                omitted_topic_candidates += omitted
                topic_payloads.append(
                    {
                        "topic": topic_result.topic.model_dump(mode="json"),
                        "quorum": {
                            phase: quorum.model_dump(mode="json")
                            for phase, quorum in topic_result.quorum.items()
                        },
                        "classifications": {
                            candidate_id: classification.model_dump(mode="json")
                            for candidate_id, classification in (
                                topic_result.classifications.items()
                            )
                        },
                        "candidate_claims": topic_candidates,
                        "failures": {
                            phase: [
                                failure.model_dump(mode="json")
                                for failure in failures
                            ]
                            for phase, failures in topic_result.failures.items()
                        },
                    }
                )
            payload["topics"] = topic_payloads
        if omitted_candidates or omitted_topic_candidates:
            payload["truncation"] = {
                "candidate_claims_omitted": omitted_candidates,
                "topic_candidate_claims_omitted": omitted_topic_candidates,
            }
        if self.failed_topics:
            payload["failed_topics"] = [
                failed.model_dump(mode="json") for failed in self.failed_topics
            ]
        return payload

    def analysis_payload(self) -> dict[str, Any]:
        consensus_summary = {
            "strong": list(self.final.strong_consensus),
            "qualified": list(self.final.qualified_consensus),
        }
        disagreements = list(self.final.disputed_points)
        if self.plan_document is not None:
            consensus_summary = {
                "strong": [section.tldr for section in self.plan_document.sections],
                "qualified": [],
            }
            disagreements = [
                point
                for section in self.plan_document.sections
                for point in section.disputed_points
            ]

        payload: dict[str, Any] = {
            "analysis_version": 1,
            "protocol": "mmd.analysis.v1",
            "run_id": self.run_id,
            "mode": self.mode,
            "consensus_summary": consensus_summary,
            "disagreements": disagreements,
            "model_coverage": _candidate_coverage(
                self.normalize, self.classifications, self.proposals
            ),
            "notable_unique_points": _notable_unique_points(
                self.normalize, self.classifications, self.proposals
            ),
            "limitations": _analysis_limitations(self),
        }
        if self.topics:
            topics = []
            for topic_result in self.topics:
                strong, qualified, disputed, _rejected = _consensus_buckets(
                    topic_result.normalize, topic_result.classifications
                )
                topics.append(
                    {
                        "topic_id": topic_result.topic.topic_id,
                        "title": topic_result.topic.title,
                        "consensus_summary": {
                            "strong": strong,
                            "qualified": qualified,
                        },
                        "disagreements": disputed,
                        "model_coverage": _candidate_coverage(
                            topic_result.normalize,
                            topic_result.classifications,
                            topic_result.proposals,
                        ),
                        "notable_unique_points": _notable_unique_points(
                            topic_result.normalize,
                            topic_result.classifications,
                            topic_result.proposals,
                        ),
                    }
                )
            payload["topics"] = topics
        if self.failed_topics:
            payload["failed_topics"] = [
                failed.model_dump(mode="json") for failed in self.failed_topics
            ]
        return payload

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


def _logging_candidates(
    candidates: list[CandidateClaim], max_candidates: int | None
) -> tuple[list[dict[str, Any]], int]:
    serialized = [candidate.model_dump(mode="json") for candidate in candidates]
    if max_candidates is None:
        return serialized, 0
    return serialized[:max_candidates], max(0, len(serialized) - max_candidates)


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


class DeliberationTimeoutError(TimeoutError):
    """The complete deliberation exceeded its caller-provided wall-clock budget."""

    def __init__(self, max_run_timeout: float) -> None:
        super().__init__(
            f"MMD deliberation exceeded max_run_timeout of {max_run_timeout:g}s"
        )
        self.max_run_timeout = max_run_timeout


class CallBudgetExceededError(RuntimeError):
    def __init__(self, max_total_calls: int) -> None:
        super().__init__(
            f"MMD deliberation exceeded max_total_calls of {max_total_calls}"
        )
        self.max_total_calls = max_total_calls


async def _call_model_structured(
    *,
    client: CompletionClient,
    model: str,
    request: CompletionRequest,
    schema: type[T],
    timeout: float | None,
    max_repair_attempts: int,
    call_params: dict[str, Any] | None = None,
) -> T:
    base_request = request.with_litellm_params(call_params or {})

    async def complete(repair_note: str | None) -> str:
        next_request = base_request
        if repair_note:
            next_request = base_request.model_copy(
                update={"user_prompt": f"{base_request.user_prompt}\n\n{repair_note}"}
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
                call_params=config.call_params_for_phase("propose"),
            )
            return model, _stamp_proposal(
                run_id, model, proposal, topic.topic_id if topic else None
            )
        except CallBudgetExceededError:
            raise
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
            request = build_request(model)
            value = await _call_model_structured(
                client=client,
                model=model,
                request=request,
                schema=schema,
                timeout=config.per_model_timeout,
                max_repair_attempts=config.max_repair_attempts,
                call_params=config.call_params_for_phase(
                    str(request.meta.get("phase", "unknown"))
                ),
            )
            return model, stamp(model, value)
        except CallBudgetExceededError:
            raise
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


def _candidate_coverage(
    normalize: NormalizeResult,
    classifications: dict[str, ClassifyCandidateResult],
    proposals: list[Proposal],
) -> list[dict[str, Any]]:
    model_by_claim_id = {
        claim.claim_id: proposal.model_id
        for proposal in proposals
        for claim in proposal.claims
    }
    coverage = []
    for candidate in normalize.candidate_claims:
        classification = classifications.get(candidate.candidate_id)
        source_model_ids = sorted(
            {
                model_by_claim_id[source_claim_id]
                for source_claim_id in candidate.source_claim_ids
                if source_claim_id in model_by_claim_id
            }
        )
        coverage.append(
            {
                "candidate_id": candidate.candidate_id,
                "text": candidate.text,
                "classification": (
                    classification.label if classification is not None else "unknown"
                ),
                "approve_ratio": (
                    classification.approve_ratio
                    if classification is not None
                    else None
                ),
                "partial": classification.partial if classification is not None else True,
                "source_claim_count": len(candidate.source_claim_ids),
                "source_model_count": len(source_model_ids),
                "source_model_ids": source_model_ids,
            }
        )
    return coverage


def _notable_unique_points(
    normalize: NormalizeResult,
    classifications: dict[str, ClassifyCandidateResult],
    proposals: list[Proposal],
) -> list[dict[str, Any]]:
    unique_points = []
    for candidate in _candidate_coverage(normalize, classifications, proposals):
        if candidate["source_model_count"] != 1:
            continue
        if candidate["classification"] == "rejected":
            continue
        unique_points.append(
            {
                "candidate_id": candidate["candidate_id"],
                "text": candidate["text"],
                "source_model_id": candidate["source_model_ids"][0],
                "classification": candidate["classification"],
            }
        )
    return unique_points


def _analysis_limitations(result: DeliberationResult) -> list[str]:
    limitations = [
        "This analysis is derived deterministically from MMD consensus data; it is not a separate factual verification step."
    ]
    if result.usage.usage_unavailable:
        limitations.append("Some underlying model calls did not report token usage.")
    for phase, quorum in result.quorum.items():
        if quorum.partial:
            limitations.append(f'Phase "{phase}" met quorum with partial responses.')
    for phase, failures in result.failures.items():
        if failures:
            failed_models = ", ".join(failure.model_id for failure in failures)
            limitations.append(f'Phase "{phase}" had failed models: {failed_models}.')
    for topic_result in result.topics:
        for phase, quorum in topic_result.quorum.items():
            if quorum.partial:
                limitations.append(
                    f'Topic "{topic_result.topic.topic_id}" phase "{phase}" met quorum with partial responses.'
                )
        for phase, failures in topic_result.failures.items():
            if failures:
                failed_models = ", ".join(failure.model_id for failure in failures)
                limitations.append(
                    f'Topic "{topic_result.topic.topic_id}" phase "{phase}" had failed models: {failed_models}.'
                )
    if result.failed_topics:
        failed_topics = ", ".join(
            failed.topic.topic_id for failed in result.failed_topics
        )
        limitations.append(f"Planning mode omitted failed topics: {failed_topics}.")
    return limitations


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
        call_params=config.call_params_for_phase("normalize"),
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
        call_params=config.call_params_for_phase("compose"),
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
        tooling=config.tool_trace_info(),
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
        call_params=config.call_params_for_phase("normalize"),
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
        call_params=config.call_params_for_phase("compose"),
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
        tooling=config.tool_trace_info(),
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
        call_params=config.call_params_for_phase("normalize"),
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
        call_params=config.call_params_for_phase("outline"),
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
            call_params=config.call_params_for_phase("section_compose"),
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
        tooling=config.tool_trace_info(),
    )


async def run_deliberation(
    config: DeliberationConfig, client: CompletionClient
) -> DeliberationResult:
    if config.max_total_calls is not None:
        client = CallLimitedClient(client, config.max_total_calls)

    async def run_mode() -> DeliberationResult:
        if config.mmd_mode == "quick":
            return await run_quick_deliberation(config, client)
        if config.mmd_mode == "standard":
            return await run_standard_deliberation(config, client)
        if config.mmd_mode == "planning":
            return await run_planning_deliberation(config, client)
        raise NotImplementedError(f"unsupported mmd_mode: {config.mmd_mode}")

    if config.max_run_timeout is None:
        return await run_mode()
    try:
        return await asyncio.wait_for(run_mode(), timeout=config.max_run_timeout)
    except asyncio.TimeoutError as error:
        raise DeliberationTimeoutError(config.max_run_timeout) from error

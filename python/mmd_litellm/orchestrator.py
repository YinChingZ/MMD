from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel, Field, model_validator

from . import tools
from .client import CompletionOutput, TokenUsage, coerce_completion_output
from .consensus import ClassifyCandidateResult, classify_candidate
from .alignment import PairSupport, candidates_from_clusters, deterministic_complete_link
from .cost import estimate_call_cost
from .ids import make_run_id, stable_call_id, stable_candidate_set_id
from .policy import DeliberationPolicy, PolicyTraceInfo, resolve_deliberation_policy
from .prompts import (
    CompletionRequest,
    build_compose_prompt,
    build_align_prompt,
    build_critique_prompt,
    build_direct_answer_prompt,
    build_normalize_prompt,
    build_outline_prompt,
    build_global_compose_prompt,
    build_propose_prompt,
    build_revise_prompt,
    build_vote_prompt,
)
from .quorum import QuorumCheck, check_quorum
from .schemas import (
    Ballot,
    AlignResult,
    CandidateClaim,
    ConfidenceSummary,
    Critique,
    FinalAnswer,
    NormalizeResult,
    OutlineResult,
    PlanDocument,
    PlanningFinalAnswer,
    PlanningOutputSpan,
    Proposal,
    RevisionSet,
    SectionAnswer,
    Topic,
    VoteSet,
)
from .v3 import (
    CandidateSetTrace,
    ClassificationBasis,
    ExperimentManifest,
    Governance,
    MmdTraceV3,
    TraceArtifact,
    TraceCall,
    TraceFailure,
    resolve_governance,
    validate_model_selection,
)
from .structured import call_structured

T = TypeVar("T", bound=BaseModel)
MMDMode = Literal["quick", "standard", "planning"]
PresetName = Literal["cheap", "balanced", "strong"]
PANEL_PHASES = {"propose", "critique", "revise", "vote", "align"}
DEFAULT_MAX_TOOL_CALLS = 4
MAX_TOOL_STEPS_PER_CALL = 4
TOOL_TRACE_PREVIEW_CHARS = 500
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


def _is_mmd_alias(model: str) -> bool:
    """True for MMD's own recursive-invocation aliases (`mmd-fusion` / `mmd/*`).

    Shared by `DeliberationConfig.validate_and_limit_models`'s recursion guard and
    `litellm_provider._build_config`'s default-panel discovery filter, so the same
    check isn't duplicated in two places.
    """
    return model == "mmd-fusion" or model.startswith("mmd/")


class CompletionClient(Protocol):
    async def acomplete(
        self, model: str, request: CompletionRequest, *, timeout: float | None = None
    ) -> str | CompletionOutput:
        ...


class DeliberationConfig(BaseModel):
    question: str = Field(min_length=1)
    conversation_context: str | None = None
    analysis_models: list[str] = Field(min_length=1)
    coordinator_model: str | None = None
    preset: PresetName | None = None
    mmd_mode: MMDMode = "quick"
    governance: Governance = "centralized"
    experiment_manifest: ExperimentManifest | None = None
    deliberation_policy: DeliberationPolicy = "required"
    quorum_ratio: float = Field(default=2 / 3, gt=0, le=1)
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
    parallel_tool_calls: bool | None = None
    coordinator_tools_enabled: bool = False
    tool_mode: Literal["reject", "experimental_passthrough", "mmd_native_web"] = "reject"
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
        recursive = [model for model in configured if _is_mmd_alias(model)]
        if recursive:
            raise ValueError(
                "analysis/coordinator models must be real base models, not MMD aliases: "
                + ", ".join(recursive)
            )
        if len(self.analysis_models) > self.max_analysis_models:
            self.analysis_models = self.analysis_models[: self.max_analysis_models]
        resolve_governance(
            self.mmd_mode, self.governance, self.experiment_manifest
        )
        if self.coordinator_model and self.coordinator_model not in self.analysis_models:
            raise ValueError(
                "coordinator_model must be one of the explicitly selected analysis_models"
            )
        if len(set(self.analysis_models)) != len(self.analysis_models):
            raise ValueError("analysis_models must be distinct")
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

        eligible_phase = phase in PANEL_PHASES or self.coordinator_tools_enabled
        if self.tool_mode == "mmd_native_web" and eligible_phase:
            params["tools"] = [tools.WEB_FETCH_TOOL_SCHEMA]
            params["tool_choice"] = "auto"
        elif self.tools and eligible_phase:
            params["tools"] = self.tools
            if self.tool_choice is not None:
                params["tool_choice"] = self.tool_choice
            if self.max_tool_calls is not None:
                params["max_tool_calls"] = self.max_tool_calls
            if self.parallel_tool_calls is not None:
                params["parallel_tool_calls"] = self.parallel_tool_calls

        return {key: value for key, value in params.items() if value is not None}

    def tool_trace_info(self, tracker: ToolCallTracker | None = None) -> ToolTraceInfo:
        native_web = self.tool_mode == "mmd_native_web"
        enabled_for_panel = bool(self.tools) or native_web
        enabled_for_coordinator = bool(
            (self.tools or native_web) and self.coordinator_tools_enabled
        )
        tool_count = len(self.tools) if self.tools else (1 if native_web else 0)
        return ToolTraceInfo(
            enabled_for_panel=enabled_for_panel,
            enabled_for_coordinator=enabled_for_coordinator,
            tool_count=tool_count,
            tool_choice=self.tool_choice,
            max_tool_calls=self.max_tool_calls,
            parallel_tool_calls=self.parallel_tool_calls,
            tool_mode=self.tool_mode,
            experimental=bool(self.tools) and self.tool_mode == "experimental_passthrough",
            tool_calls_executed=tracker.executed if tracker is not None else 0,
            tool_calls_failed=tracker.failed if tracker is not None else 0,
            tool_call_events=list(tracker.events) if tracker is not None else [],
        )


class PhaseFailure(BaseModel):
    model_id: str
    message: str
    code: str | None = None


class ToolCallEvent(BaseModel):
    call_index: int
    phase: str
    model_id: str
    role: Literal["panel", "coordinator"]
    topic_id: str | None = None
    tool_name: str
    arguments: str
    status: Literal["ok", "error", "blocked"]
    result_preview: str | None = None
    error: str | None = None
    duration_seconds: float | None = None


class ToolTraceInfo(BaseModel):
    enabled_for_panel: bool = False
    enabled_for_coordinator: bool = False
    tool_count: int = 0
    tool_choice: Any | None = None
    max_tool_calls: int | None = None
    parallel_tool_calls: bool | None = None
    tool_mode: Literal["reject", "experimental_passthrough", "mmd_native_web"] = "reject"
    experimental: bool = False
    tool_calls_executed: int = 0
    tool_calls_failed: int = 0
    tool_call_events: list[ToolCallEvent] = Field(default_factory=list)


class UsageEvent(BaseModel):
    call_index: int
    phase: str
    model_id: str
    topic_id: str | None = None
    role: Literal["panel", "coordinator"]
    usage: TokenUsage | None = None
    usage_unavailable: bool = False
    duration_seconds: float | None = None
    cost_usd: float | None = None
    cost_unavailable: bool = False
    status: Literal["completed", "failed", "timeout"] = "completed"
    error_code: str | None = None


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


class RolePerformance(BaseModel):
    role: Literal["panel", "coordinator", "overall"]
    call_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    success_rate: float | None = None
    partial: bool = False
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    total_duration_seconds: float = 0.0
    cost_usd: float | None = None
    cost_unavailable: bool = False
    cost_unavailable_count: int = 0


class PerformanceSummary(BaseModel):
    panel: RolePerformance
    coordinator: RolePerformance
    overall: RolePerformance


class UsageTracker:
    def __init__(self) -> None:
        self.events: list[UsageEvent] = []

    def record(
        self,
        *,
        model: str,
        request: CompletionRequest,
        usage: TokenUsage | None,
        duration_seconds: float,
        precomputed_cost_usd: float | None = None,
        status: Literal["completed", "failed", "timeout"] = "completed",
        error_code: str | None = None,
    ) -> None:
        phase = str(request.meta.get("phase", "unknown"))
        role: Literal["panel", "coordinator"] = (
            "panel" if phase in PANEL_PHASES else "coordinator"
        )
        cost_estimate = estimate_call_cost(
            model, usage, precomputed_cost_usd=precomputed_cost_usd
        )
        self.events.append(
            UsageEvent(
                call_index=len(self.events),
                phase=phase,
                model_id=model,
                topic_id=request.meta.get("topic_id"),
                role=role,
                usage=usage,
                usage_unavailable=usage is None,
                duration_seconds=duration_seconds,
                cost_usd=cost_estimate.cost_usd,
                cost_unavailable=cost_estimate.cost_unavailable,
                status=status,
                error_code=error_code,
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


class ToolCallTracker:
    def __init__(self) -> None:
        self.events: list[ToolCallEvent] = []

    def record(
        self,
        *,
        phase: str,
        model_id: str,
        role: Literal["panel", "coordinator"],
        topic_id: str | None,
        tool_name: str,
        arguments: str,
        status: Literal["ok", "error", "blocked"],
        result_preview: str | None,
        error: str | None,
        duration_seconds: float | None,
    ) -> None:
        self.events.append(
            ToolCallEvent(
                call_index=len(self.events),
                phase=phase,
                model_id=model_id,
                role=role,
                topic_id=topic_id,
                tool_name=tool_name,
                arguments=arguments,
                status=status,
                result_preview=result_preview,
                error=error,
                duration_seconds=duration_seconds,
            )
        )

    @property
    def executed(self) -> int:
        return len(self.events)

    @property
    def failed(self) -> int:
        return sum(1 for event in self.events if event.status != "ok")


class UsageCollectingClient:
    def __init__(self, client: CompletionClient, tracker: UsageTracker) -> None:
        self.client = client
        self.tracker = tracker

    async def acomplete(
        self, model: str, request: CompletionRequest, *, timeout: float | None = None
    ) -> str | CompletionOutput:
        start = time.monotonic()
        try:
            output = await self.client.acomplete(model, request, timeout=timeout)
        except Exception as error:
            duration_seconds = time.monotonic() - start
            self.tracker.record(
                model=model,
                request=request,
                usage=None,
                duration_seconds=duration_seconds,
                status=("timeout" if isinstance(error, TimeoutError) else "failed"),
                error_code=type(error).__name__,
            )
            raise
        duration_seconds = time.monotonic() - start
        completion = coerce_completion_output(output)
        self.tracker.record(
            model=model,
            request=request,
            usage=completion.usage,
            duration_seconds=duration_seconds,
            precomputed_cost_usd=completion.cost_usd,
        )
        return output

    def count_tokens(self, model: str, text: str) -> int | None:
        counter = getattr(self.client, "count_tokens", None)
        return counter(model, text) if callable(counter) else None

    def context_window(self, model: str) -> int | None:
        getter = getattr(self.client, "context_window", None)
        return getter(model) if callable(getter) else None


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

    def count_tokens(self, model: str, text: str) -> int | None:
        counter = getattr(self.client, "count_tokens", None)
        return counter(model, text) if callable(counter) else None

    def context_window(self, model: str) -> int | None:
        getter = getattr(self.client, "context_window", None)
        return getter(model) if callable(getter) else None


class ToolExecutingClient:
    """Resolves `tool_calls`-only responses by executing MMD's built-in
    `web_fetch` tool and re-calling the model with the result.

    Only constructed when `tool_mode == "mmd_native_web"`; `reject` and
    `experimental_passthrough` callers never see this class, so their
    behavior is unaffected. Wraps the already `UsageCollectingClient`/
    `CallLimitedClient`-wrapped client, so tool-loop continuation calls still
    count against `max_total_calls` and get usage/cost tracked - those are
    real model calls, distinct from `max_tool_calls`, the tool-execution budget
    enforced here.
    """

    def __init__(
        self,
        client: CompletionClient,
        *,
        tracker: ToolCallTracker,
        max_tool_calls: int,
        executor: Any = None,
    ) -> None:
        self.client = client
        self.tracker = tracker
        self.max_tool_calls = max_tool_calls
        # Looked up at construction time, not bound as a frozen default, so
        # tests can `monkeypatch.setattr(tools, "execute_tool_call", fake)`
        # and have it take effect for instances created afterward.
        self.executor = executor or tools.execute_tool_call
        self.calls_made = 0

    async def acomplete(
        self, model: str, request: CompletionRequest, *, timeout: float | None = None
    ) -> str | CompletionOutput:
        current = request
        for _ in range(MAX_TOOL_STEPS_PER_CALL):
            raw_output = await self.client.acomplete(model, current, timeout=timeout)
            output = coerce_completion_output(raw_output)
            if not output.tool_calls:
                return raw_output

            phase = str(current.meta.get("phase", "unknown"))
            role: Literal["panel", "coordinator"] = (
                "panel" if phase in PANEL_PHASES else "coordinator"
            )
            topic_id = current.meta.get("topic_id")
            assistant_turn: dict[str, Any] = {
                "role": "assistant",
                "content": output.text or None,
                "tool_calls": output.tool_calls,
            }
            tool_turns: list[dict[str, Any]] = []
            for call in output.tool_calls:
                if self.calls_made >= self.max_tool_calls:
                    raise ToolCallBudgetExceededError(self.max_tool_calls)
                self.calls_made += 1
                result = await self.executor(call)
                self.tracker.record(
                    phase=phase,
                    model_id=model,
                    role=role,
                    topic_id=topic_id,
                    tool_name=result.tool_name,
                    arguments=result.arguments,
                    status=result.status,
                    result_preview=(result.content[:TOOL_TRACE_PREVIEW_CHARS] or None),
                    error=result.error,
                    duration_seconds=result.duration_seconds,
                )
                tool_turns.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id", ""),
                        "content": result.content,
                    }
                )
            current = current.with_extra_turns([assistant_turn, *tool_turns])

        raise ValueError(
            f"tool-call loop did not resolve within {MAX_TOOL_STEPS_PER_CALL} steps"
        )

    def count_tokens(self, model: str, text: str) -> int | None:
        counter = getattr(self.client, "count_tokens", None)
        return counter(model, text) if callable(counter) else None

    def context_window(self, model: str) -> int | None:
        getter = getattr(self.client, "context_window", None)
        return getter(model) if callable(getter) else None


def _apply_native_web_tools(
    client: CompletionClient, config: DeliberationConfig, tracker: ToolCallTracker
) -> CompletionClient:
    if config.tool_mode != "mmd_native_web":
        return client
    effective_max_tool_calls = (
        config.max_tool_calls
        if config.max_tool_calls is not None
        else DEFAULT_MAX_TOOL_CALLS
    )
    return ToolExecutingClient(
        client, tracker=tracker, max_tool_calls=effective_max_tool_calls
    )


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
    candidate_set_id: str | None = None


class FailedTopic(BaseModel):
    topic: Topic
    error: str


class DeliberationResult(BaseModel):
    run_id: str
    question: str
    mode: MMDMode
    governance: Governance = "centralized"
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
    planning_final: PlanningFinalAnswer | None = None
    planning_context: dict[str, Any] | None = None
    alignment: Any | None = None
    trace: MmdTraceV3 | None = None
    usage: UsageSummary = Field(default_factory=UsageSummary)
    tooling: ToolTraceInfo = Field(default_factory=ToolTraceInfo)
    policy: PolicyTraceInfo | None = None
    performance: PerformanceSummary | None = None

    def trace_payload(self) -> dict[str, Any]:
        if self.trace is None:
            raise RuntimeError("new executions must attach mmd.trace.v3")
        return self.trace.model_dump(mode="json", exclude_none=True)

    def logging_trace_payload(
        self, *, max_candidates: int | None = None
    ) -> dict[str, Any]:
        del max_candidates  # v3 logging emits the canonical trace without truncation.
        return self.trace_payload()

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
            "performance": (
                self.performance.model_dump(mode="json")
                if self.performance is not None
                else None
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


class ToolCallBudgetExceededError(RuntimeError):
    def __init__(self, max_tool_calls: int) -> None:
        super().__init__(
            f"MMD deliberation exceeded max_tool_calls of {max_tool_calls}"
        )
        self.max_tool_calls = max_tool_calls


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


async def _call_coordinator_structured(
    *,
    client: CompletionClient,
    model: str,
    request: CompletionRequest,
    schema: type[T],
    timeout: float | None,
    call_params: dict[str, Any] | None = None,
) -> T:
    """Run one coordinator generation and exactly one whole-call retry."""

    last_error: Exception | None = None
    for _attempt in range(2):
        try:
            return await _call_model_structured(
                client=client,
                model=model,
                request=request,
                schema=schema,
                timeout=timeout,
                max_repair_attempts=0,
                call_params=call_params,
            )
        except (CallBudgetExceededError, ToolCallBudgetExceededError):
            raise
        except Exception as error:
            last_error = error
    assert last_error is not None
    raise last_error


async def _call_model_raw(
    *,
    client: CompletionClient,
    model: str,
    request: CompletionRequest,
    timeout: float | None,
    call_params: dict[str, Any] | None = None,
) -> str:
    base_request = request.with_litellm_params(call_params or {})
    output = await client.acomplete(model, base_request, timeout=timeout)
    return coerce_completion_output(output).text


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
                update={"claim_id": local_id, "topic_id": topic_id}
            )
        )
    return proposal.model_copy(update={"model_id": model_id, "claims": claims})


def _stamp_critique(model_id: str, critique: Critique) -> Critique:
    return critique.model_copy(update={"reviewer_model_id": model_id})


def _stamp_revision_set(model_id: str, revision_set: RevisionSet) -> RevisionSet:
    return revision_set.model_copy(update={"model_id": model_id})


def _stamp_vote_set(model_id: str, vote_set: VoteSet) -> VoteSet:
    return vote_set.model_copy(update={"model_id": model_id})


def _sanitize_vote_sets(
    vote_sets: list[VoteSet], candidate_ids: set[str]
) -> list[VoteSet]:
    sanitized: list[VoteSet] = []
    for vote_set in vote_sets:
        seen: set[str] = set()
        ballots = []
        for ballot in vote_set.votes:
            if ballot.candidate_id not in candidate_ids or ballot.candidate_id in seen:
                continue
            seen.add(ballot.candidate_id)
            ballots.append(ballot)
        sanitized.append(vote_set.model_copy(update={"votes": ballots}))
    return sanitized


def _stamp_normalize(
    run_id: str,
    normalize: NormalizeResult,
    claims: list[ResolvedClaim],
    topic_id: str | None = None,
) -> NormalizeResult:
    expected_claim_ids = {claim.claim_id for claim in claims}
    assigned_claim_ids: set[str] = set()
    candidates = sorted(
        normalize.candidate_claims,
        key=lambda candidate: (
            tuple(sorted(candidate.source_claim_ids)),
            candidate.text,
        ),
    )
    for candidate in candidates:
        for claim_id in candidate.source_claim_ids:
            if claim_id not in expected_claim_ids:
                raise ValueError(f"normalize referenced unknown claim: {claim_id}")
            if claim_id in assigned_claim_ids:
                raise ValueError(f"normalize assigned claim more than once: {claim_id}")
            assigned_claim_ids.add(claim_id)
    missing = sorted(expected_claim_ids - assigned_claim_ids)
    if missing:
        raise ValueError("normalize omitted claims: " + ", ".join(missing))
    return NormalizeResult(
        candidate_claims=[
            candidate.model_copy(
                update={
                    "candidate_id": (
                        f"{run_id}::{topic_id or 'root'}::candidate::{index:03d}"
                    ),
                    "source_claim_ids": sorted(set(candidate.source_claim_ids)),
                    "topic_id": topic_id or candidate.topic_id,
                }
            )
            for index, candidate in enumerate(candidates)
        ]
    )


def _fallback_normalize(
    run_id: str,
    claims: list[ResolvedClaim],
    topic_id: str | None = None,
) -> NormalizeResult:
    """Preserve every immutable claim when coordinator normalization fails."""

    scope = topic_id or "root"
    ordered = sorted(claims, key=lambda claim: claim.claim_id)
    return NormalizeResult(
        candidate_claims=[
            CandidateClaim(
                candidate_id=f"{run_id}::{scope}::candidate::{index:03d}",
                text=claim.text,
                source_claim_ids=[claim.claim_id],
                topic_id=topic_id,
                notes="deterministic fallback after coordinator normalization failure",
            )
            for index, claim in enumerate(ordered)
        ]
    )


def _fallback_final(
    *,
    strong: list[str],
    qualified: list[str],
    disputed: list[str],
    rejected: list[str],
    position_changes: list[dict[str, Any]],
    note: str,
) -> FinalAnswer:
    parts: list[str] = []
    if strong:
        parts.append("Strong consensus:\n" + "\n".join(f"- {item}" for item in strong))
    if qualified:
        parts.append(
            "Qualified consensus:\n" + "\n".join(f"- {item}" for item in qualified)
        )
    if disputed:
        parts.append("Disputed:\n" + "\n".join(f"- {item}" for item in disputed))
    return FinalAnswer(
        final_answer="\n\n".join(parts) or "No supported candidate reached consensus.",
        strong_consensus=strong,
        qualified_consensus=qualified,
        disputed_points=disputed,
        rejected_or_unsupported=rejected,
        model_position_changes=position_changes,
        confidence_summary={
            "consensus_strength": "low" if disputed else "medium",
            "notes": note,
        },
    )


def _global_compose_context_profile(
    client: CompletionClient,
    model: str,
    candidates: list[dict[str, Any]],
) -> tuple[bool, dict[str, Any]]:
    serialized = json.dumps(candidates, ensure_ascii=False, sort_keys=True)
    counter = getattr(client, "count_tokens", None)
    window_getter = getattr(client, "context_window", None)
    token_count = counter(model, serialized) if callable(counter) else None
    context_window = window_getter(model) if callable(window_getter) else None
    if token_count is not None and context_window is not None:
        limit = max(1, int(context_window * 0.8))
        return token_count > limit, {
            "token_count": token_count,
            "context_window": context_window,
            "input_limit": limit,
            "source": "litellm_metadata",
        }
    return len(serialized) > 60_000, {
        "estimated_tokens": max(1, len(serialized) // 4),
        "serialized_characters": len(serialized),
        "source": "deterministic_fallback",
    }


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
                question=config.question,
                model_id=model,
                topic=topic,
                conversation_context=config.conversation_context,
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
        except ToolCallBudgetExceededError:
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
        except ToolCallBudgetExceededError:
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


async def _distributed_normalize(
    *,
    client: CompletionClient,
    config: DeliberationConfig,
    run_id: str,
    claims: list[ResolvedClaim],
    topic: Topic | None = None,
) -> tuple[NormalizeResult, dict[str, Any], QuorumCheck, list[PhaseFailure]]:
    claim_payload = [claim.model_dump() for claim in claims]
    outcome = await _fanout_structured(
        client=client,
        config=config,
        schema=AlignResult,
        build_request=lambda model: build_align_prompt(
            question=config.question,
            aligner_model_id=model,
            claims=claim_payload,
            topic=topic,
        ),
        stamp=lambda model, result: result.model_copy(
            update={"aligner_model_id": model}
        ),
    )
    if not outcome.quorum.met:
        raise QuorumNotMetError("align", outcome.quorum, outcome.failures)
    alignments = [value for value in outcome.values if isinstance(value, AlignResult)]
    pair_map: dict[tuple[str, str], PairSupport] = {}
    for alignment in alignments:
        for judgment in alignment.judgments:
            left, right = sorted(
                (judgment.left_claim_id, judgment.right_claim_id)
            )
            if left == right:
                continue
            current = pair_map.get(
                (left, right), PairSupport(left, right, support=0, cannot_link=False)
            )
            pair_map[(left, right)] = PairSupport(
                left,
                right,
                support=current.support + (1 if judgment.relation == "equivalent" else 0),
                cannot_link=(
                    current.cannot_link
                    or judgment.cannot_link
                    or judgment.relation == "conflict"
                ),
            )
    policy = config.experiment_manifest.alignment_policy  # type: ignore[union-attr]
    clusters, decisions = deterministic_complete_link(
        [claim.claim_id for claim in claims],
        list(pair_map.values()),
        policy.minimum_pair_support,  # type: ignore[union-attr]
    )
    normalize = NormalizeResult(
        candidate_claims=candidates_from_clusters(
            run_id=run_id,
            topic_id=topic.topic_id if topic else None,
            claims=claims,
            clusters=clusters,
        )
    )
    return (
        normalize,
        {
            "policy": policy.model_dump(),  # type: ignore[union-attr]
            "alignments": [item.model_dump() for item in alignments],
            "decisions": decisions,
        },
        outcome.quorum,
        outcome.failures,
    )


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


def _candidate_set_trace(
    *,
    run_id: str,
    governance: Governance,
    normalize: NormalizeResult,
    classifications: dict[str, ClassifyCandidateResult],
    votes: list[VoteSet],
    proposals: list[Proposal],
    expected_voter_count: int,
    topic_id: str | None = None,
    alignment: Any | None = None,
) -> CandidateSetTrace:
    candidate_set_id = stable_candidate_set_id(run_id, governance, topic_id)
    ballot_map = _ballots_by_candidate(votes)
    claims_by_id = {
        claim.claim_id: claim for claim in _resolved_claims(proposals)
    }
    basis: dict[str, ClassificationBasis] = {}
    for candidate in normalize.candidate_claims:
        ballots = ballot_map.get(candidate.candidate_id)
        if ballots is None:
            ballots = _implied_ballots_from_coverage(candidate, claims_by_id)
        classification = classifications[candidate.candidate_id]
        basis[candidate.candidate_id] = ClassificationBasis(
            candidate_set_id=candidate_set_id,
            expected_voter_count=expected_voter_count,
            ballots=ballots,
            approve_ratio=classification.approve_ratio,
            label=classification.label,
            partial=classification.partial,
        )
    return CandidateSetTrace(
        candidate_set_id=candidate_set_id,
        governance=governance,
        topic_id=topic_id,
        candidate_ids=[candidate.candidate_id for candidate in normalize.candidate_claims],
        classification_basis=basis,
        alignment=alignment,
    )


def _attach_v3_trace(
    result: DeliberationResult, *, expected_voter_count: int
) -> DeliberationResult:
    trace = MmdTraceV3(
        run_id=result.run_id,
        mode=result.mode,
        governance=result.governance,
    )
    attempts: dict[tuple[str, str, str | None], int] = {}
    for event in result.usage.events:
        usage = event.usage.model_dump() if event.usage else None
        attempt_key = (event.phase, event.model_id, event.topic_id)
        attempt = attempts.get(attempt_key, 0)
        attempts[attempt_key] = attempt + 1
        trace.calls.append(
            TraceCall(
                call_id=stable_call_id(
                    result.run_id,
                    event.phase,
                    event.model_id,
                    event.call_index,
                    event.topic_id,
                ),
                phase=event.phase,
                model_id=event.model_id,
                role=event.role,
                status=event.status,
                attempt=attempt,
                topic_id=event.topic_id,
                usage=(
                    {
                        "prompt_tokens": usage["prompt_tokens"],
                        "completion_tokens": usage["completion_tokens"],
                        "total_tokens": usage["total_tokens"],
                        "cost_usd": event.cost_usd or 0,
                        "usage_unavailable_count": 0,
                    }
                    if usage
                    else {
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                        "cost_usd": event.cost_usd or 0,
                        "usage_unavailable_count": 1,
                    }
                ),
                cost_usd=event.cost_usd,
                latency_ms=(
                    event.duration_seconds * 1000
                    if event.duration_seconds is not None
                    else None
                ),
                error_code=event.error_code,
            )
        )
    total_cost = sum(event.cost_usd or 0 for event in result.usage.events)
    trace.usage = {
        "prompt_tokens": result.usage.prompt_tokens,
        "completion_tokens": result.usage.completion_tokens,
        "total_tokens": result.usage.total_tokens,
        "cost_usd": total_cost,
        "usage_unavailable_count": result.usage.usage_unavailable_count,
    }
    trace.quorum = [
        {
            "phase": phase,
            "met": check.met,
            "required": check.required,
            "respondent_count": check.respondent_count,
            "expected_count": expected_voter_count,
            "partial": check.partial,
        }
        for phase, check in result.quorum.items()
    ] + [
        {
            "phase": phase,
            "topic_id": topic_result.topic.topic_id,
            "met": check.met,
            "required": check.required,
            "respondent_count": check.respondent_count,
            "expected_count": expected_voter_count,
            "partial": check.partial,
        }
        for topic_result in result.topics
        for phase, check in topic_result.quorum.items()
    ]
    if result.proposals:
        trace.artifacts.extend(
            [
                TraceArtifact(
                    artifact_id=f"{result.run_id}::artifact::proposals",
                    kind="proposal_set",
                    phase="propose",
                    status="partial" if result.quorum.get("propose") and result.quorum["propose"].partial else "completed",
                    payload=result.proposals,
                ),
                TraceArtifact(
                    artifact_id=f"{result.run_id}::artifact::post_revision_claims",
                    kind="post_revision_claim_set",
                    phase="revise" if result.revisions else "propose",
                    status="completed",
                    parent_ids=[f"{result.run_id}::artifact::proposals"],
                    payload=_resolved_claims(result.proposals, result.revisions),
                ),
            ]
        )
        candidate_set = _candidate_set_trace(
            run_id=result.run_id,
            governance=result.governance,
            normalize=result.normalize,
            classifications=result.classifications,
            votes=result.votes,
            proposals=result.proposals,
            expected_voter_count=expected_voter_count,
            alignment=result.alignment,
        )
        trace.candidate_sets.append(candidate_set)
        trace.artifacts.append(
            TraceArtifact(
                artifact_id=f"{result.run_id}::artifact::classifications",
                kind="classification_ledger",
                phase="classify",
                status="completed",
                candidate_set_id=candidate_set.candidate_set_id,
                parent_ids=[f"{result.run_id}::artifact::post_revision_claims"],
                payload=candidate_set.classification_basis,
            )
        )
    for topic_result in result.topics:
        candidate_set = _candidate_set_trace(
            run_id=result.run_id,
            governance="centralized",
            normalize=topic_result.normalize,
            classifications=topic_result.classifications,
            votes=topic_result.votes,
            proposals=topic_result.proposals,
            expected_voter_count=expected_voter_count,
            topic_id=topic_result.topic.topic_id,
        )
        trace.candidate_sets.append(candidate_set)
        trace.artifacts.append(
            TraceArtifact(
                artifact_id=f"{result.run_id}::{topic_result.topic.topic_id}::artifact::topic_ledger",
                kind="topic_ledger",
                phase="classify",
                status=(
                    "partial"
                    if any(check.partial for check in topic_result.quorum.values())
                    else "completed"
                ),
                topic_id=topic_result.topic.topic_id,
                candidate_set_id=candidate_set.candidate_set_id,
                payload=topic_result,
            )
        )
    if "topic_brief" in result.failures:
        trace.artifacts.append(
            TraceArtifact(
                artifact_id=f"{result.run_id}::artifact::topic_briefs",
                kind="topic_brief_set",
                phase="topic_brief",
                status="completed",
                parent_ids=[
                    f"{result.run_id}::{topic.topic.topic_id}::artifact::topic_ledger"
                    for topic in result.topics
                ],
                payload={
                    "strategy": "truncate_candidate_text",
                    "max_candidate_characters": 1200,
                    "context_profile": result.planning_context,
                    "source_candidate_ids": [
                        candidate.candidate_id
                        for topic in result.topics
                        for candidate in topic.normalize.candidate_claims
                    ],
                },
            )
        )
    if result.planning_final is not None:
        trace.artifacts.append(
            TraceArtifact(
                artifact_id=f"{result.run_id}::artifact::planning_final",
                kind="planning_final_answer",
                phase="global_compose",
                status=(
                    "partial" if result.failures.get("global_compose") else "completed"
                ),
                parent_ids=[
                    f"{result.run_id}::{topic.topic.topic_id}::artifact::topic_ledger"
                    for topic in result.topics
                ],
                payload=result.planning_final,
            )
        )
    for phase, failures in result.failures.items():
        for failure in failures:
            trace.failures.append(
                TraceFailure(
                    phase=phase,
                    code=failure.code
                    or (
                        "global_compose_failed"
                        if phase == "global_compose"
                        else (
                            "coordinator_failed"
                            if phase == "compose"
                            else "phase_partial_failure"
                        )
                    ),
                    message=failure.message,
                    recoverable=True,
                    model_id=failure.model_id,
                )
            )
    for failed_topic in result.failed_topics:
        trace.failures.append(
            TraceFailure(
                phase="topic",
                code="topic_failed",
                message=failed_topic.error,
                recoverable=True,
                topic_id=failed_topic.topic.topic_id,
            )
        )
    trace.status = "partial" if trace.failures else "completed"
    return result.model_copy(update={"trace": trace})


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


def _compute_performance_summary(result: DeliberationResult) -> PerformanceSummary:
    """Per-role call, usage, cost, latency, and partial-result statistics."""
    buckets: dict[str, dict[str, Any]] = {
        role: {
            "success_count": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "duration": 0.0,
            "cost_usd": 0.0,
            "cost_present": False,
            "cost_unavailable_count": 0,
        }
        for role in ("panel", "coordinator")
    }
    for event in result.usage.events:
        bucket = buckets[event.role]
        if event.status == "completed":
            bucket["success_count"] += 1
        if event.usage is not None:
            bucket["prompt_tokens"] += event.usage.prompt_tokens
            bucket["completion_tokens"] += event.usage.completion_tokens
            bucket["total_tokens"] += event.usage.total_tokens
        if event.duration_seconds is not None:
            bucket["duration"] += event.duration_seconds
        if event.cost_unavailable:
            bucket["cost_unavailable_count"] += 1
        elif event.cost_usd is not None:
            bucket["cost_usd"] += event.cost_usd
            bucket["cost_present"] = True

    failure_counts = {
        role: sum(1 for event in result.usage.events if event.role == role and event.status != "completed")
        for role in ("panel", "coordinator")
    }

    partial = {"panel": False, "coordinator": False}

    def _tally_partial(quorum: dict[str, QuorumCheck]) -> None:
        for check in quorum.values():
            if check.partial:
                partial["panel"] = True

    _tally_partial(result.quorum)
    for topic_result in result.topics:
        _tally_partial(topic_result.quorum)
    for phase, phase_failures in result.failures.items():
        if phase_failures:
            partial["panel" if phase in PANEL_PHASES else "coordinator"] = True
    if result.failed_topics:
        partial["panel"] = True

    def _role_performance(role: Literal["panel", "coordinator"]) -> RolePerformance:
        bucket = buckets[role]
        success_count = int(bucket["success_count"])
        failure_count = failure_counts[role]
        call_count = success_count + failure_count
        return RolePerformance(
            role=role,
            call_count=call_count,
            success_count=success_count,
            failure_count=failure_count,
            success_rate=(success_count / call_count) if call_count > 0 else None,
            partial=partial[role],
            prompt_tokens=int(bucket["prompt_tokens"]),
            completion_tokens=int(bucket["completion_tokens"]),
            total_tokens=int(bucket["total_tokens"]),
            total_duration_seconds=float(bucket["duration"]),
            cost_usd=float(bucket["cost_usd"]) if bucket["cost_present"] else None,
            cost_unavailable=bool(bucket["cost_unavailable_count"]),
            cost_unavailable_count=int(bucket["cost_unavailable_count"]),
        )

    panel = _role_performance("panel")
    coordinator = _role_performance("coordinator")
    combined_calls = panel.call_count + coordinator.call_count
    combined_success = panel.success_count + coordinator.success_count
    combined_cost_present = panel.cost_usd is not None or coordinator.cost_usd is not None
    overall = RolePerformance(
        role="overall",
        call_count=combined_calls,
        success_count=combined_success,
        failure_count=panel.failure_count + coordinator.failure_count,
        success_rate=(combined_success / combined_calls) if combined_calls > 0 else None,
        partial=panel.partial or coordinator.partial,
        prompt_tokens=panel.prompt_tokens + coordinator.prompt_tokens,
        completion_tokens=panel.completion_tokens + coordinator.completion_tokens,
        total_tokens=panel.total_tokens + coordinator.total_tokens,
        total_duration_seconds=panel.total_duration_seconds
        + coordinator.total_duration_seconds,
        cost_usd=(
            (panel.cost_usd or 0.0) + (coordinator.cost_usd or 0.0)
            if combined_cost_present
            else None
        ),
        cost_unavailable=panel.cost_unavailable or coordinator.cost_unavailable,
        cost_unavailable_count=panel.cost_unavailable_count
        + coordinator.cost_unavailable_count,
    )
    return PerformanceSummary(panel=panel, coordinator=coordinator, overall=overall)


def _analysis_limitations(result: DeliberationResult) -> list[str]:
    limitations = [
        "This analysis is derived deterministically from MMD consensus data; it is not a separate factual verification step."
    ]
    if result.usage.usage_unavailable:
        limitations.append("Some underlying model calls did not report token usage.")
    if result.performance is not None and result.performance.overall.cost_unavailable:
        limitations.append(
            "Cost estimates were unavailable for some model calls (litellm not installed or the model is not in litellm's pricing map)."
        )
    if result.policy is not None and not result.policy.deliberated:
        limitations.append(
            f"deliberation_policy={result.policy.policy}: no cross-model consensus was computed for this response."
        )
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


async def _run_single_model_completion(
    config: DeliberationConfig, client: CompletionClient
) -> DeliberationResult:
    """`deliberation_policy` off/auto-skip path: one direct call, no fan-out."""
    usage_tracker = UsageTracker()
    client = UsageCollectingClient(client, usage_tracker)
    tool_tracker = ToolCallTracker()
    client = _apply_native_web_tools(client, config, tool_tracker)
    run_id = make_run_id()
    coordinator = config.coordinator_model or config.analysis_models[0]

    text = await _call_model_raw(
        client=client,
        model=coordinator,
        request=build_direct_answer_prompt(
            question=config.question,
            conversation_context=config.conversation_context,
        ),
        timeout=config.per_model_timeout,
        call_params=config.call_params_for_phase("direct_answer"),
    )
    final = FinalAnswer(
        final_answer=text,
        confidence_summary=ConfidenceSummary(
            consensus_strength="high",
            notes="deliberation_policy=off: single-model direct response; no cross-model consensus was computed.",
        ),
    )

    return DeliberationResult(
        run_id=run_id,
        question=config.question,
        mode=config.mmd_mode,
        proposals=[],
        normalize=NormalizeResult(candidate_claims=[]),
        classifications={},
        final=final,
        quorum={},
        failures={},
        usage=usage_tracker.summary(),
        tooling=config.tool_trace_info(tool_tracker),
    )


async def run_quick_deliberation(
    config: DeliberationConfig, client: CompletionClient
) -> DeliberationResult:
    if config.mmd_mode != "quick":
        raise NotImplementedError("only quick mode is implemented in this PoC")
    validate_model_selection("quick", config.analysis_models, config.coordinator_model)
    governance = resolve_governance(
        config.mmd_mode, config.governance, config.experiment_manifest
    )

    usage_tracker = UsageTracker()
    client = UsageCollectingClient(client, usage_tracker)
    tool_tracker = ToolCallTracker()
    client = _apply_native_web_tools(client, config, tool_tracker)
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
    failures: dict[str, list[PhaseFailure]] = {
        "propose": propose_outcome.failures
    }
    try:
        normalize = await _call_coordinator_structured(
            client=client,
            model=coordinator,
            request=build_normalize_prompt(
                question=config.question,
                claims=claim_payload,
            ),
            schema=NormalizeResult,
            timeout=config.per_model_timeout,
            call_params=config.call_params_for_phase("normalize"),
        )
        normalize = _stamp_normalize(run_id, normalize, claims)
    except (CallBudgetExceededError, ToolCallBudgetExceededError):
        raise
    except Exception as error:
        failures["normalize"] = [
            PhaseFailure(model_id=coordinator, message=str(error))
        ]
        normalize = _fallback_normalize(run_id, claims)

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
    try:
        final = await _call_coordinator_structured(
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
            call_params=config.call_params_for_phase("compose"),
        )
    except (CallBudgetExceededError, ToolCallBudgetExceededError):
        raise
    except Exception as error:
        failures["compose"] = [
            PhaseFailure(model_id=coordinator, message=str(error))
        ]
        final = _fallback_final(
            strong=strong,
            qualified=qualified,
            disputed=disputed,
            rejected=rejected,
            position_changes=[],
            note="Coordinator compose failed after one retry; deterministic classification ledger rendered instead.",
        )

    result = DeliberationResult(
        run_id=run_id,
        question=config.question,
        mode="quick",
        governance=governance,
        proposals=propose_outcome.proposals,
        normalize=normalize,
        classifications=classifications,
        final=final,
        quorum={"propose": propose_outcome.quorum},
        failures=failures,
        usage=usage_tracker.summary(),
        tooling=config.tool_trace_info(tool_tracker),
    )
    return _attach_v3_trace(result, expected_voter_count=len(config.analysis_models))


async def run_standard_deliberation(
    config: DeliberationConfig, client: CompletionClient
) -> DeliberationResult:
    if config.mmd_mode != "standard":
        raise ValueError("run_standard_deliberation requires mmd_mode='standard'")
    validate_model_selection("standard", config.analysis_models, config.coordinator_model)
    governance = resolve_governance(
        config.mmd_mode, config.governance, config.experiment_manifest
    )

    usage_tracker = UsageTracker()
    client = UsageCollectingClient(client, usage_tracker)
    tool_tracker = ToolCallTracker()
    client = _apply_native_web_tools(client, config, tool_tracker)
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
    alignment: Any | None = None
    if governance == "distributed":
        normalize, alignment, align_quorum, align_failures = await _distributed_normalize(
            client=client,
            config=config,
            run_id=run_id,
            claims=claims,
        )
        quorum["align"] = align_quorum
        failures["align"] = align_failures
    else:
        try:
            normalize = await _call_coordinator_structured(
                client=client,
                model=coordinator,
                request=build_normalize_prompt(
                    question=config.question,
                    claims=claim_payload,
                ),
                schema=NormalizeResult,
                timeout=config.per_model_timeout,
                call_params=config.call_params_for_phase("normalize"),
            )
            normalize = _stamp_normalize(run_id, normalize, claims)
        except (CallBudgetExceededError, ToolCallBudgetExceededError):
            raise
        except Exception as error:
            failures["normalize"] = [
                PhaseFailure(model_id=coordinator, message=str(error))
            ]
            normalize = _fallback_normalize(run_id, claims)

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
    votes = _sanitize_vote_sets(
        [value for value in vote_outcome.values if isinstance(value, VoteSet)],
        {candidate.candidate_id for candidate in normalize.candidate_claims},
    )
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
    position_changes = _position_changes(propose_outcome.proposals, revisions)
    try:
        final = await _call_coordinator_structured(
            client=client,
            model=coordinator,
            request=build_compose_prompt(
                question=config.question,
                strong_consensus=strong,
                qualified_consensus=qualified,
                disputed=disputed,
                rejected=rejected,
                position_changes=position_changes,
            ),
            schema=FinalAnswer,
            timeout=config.per_model_timeout,
            call_params=config.call_params_for_phase("compose"),
        )
    except (CallBudgetExceededError, ToolCallBudgetExceededError):
        raise
    except Exception as error:
        failures["compose"] = [
            PhaseFailure(model_id=coordinator, message=str(error))
        ]
        final = _fallback_final(
            strong=strong,
            qualified=qualified,
            disputed=disputed,
            rejected=rejected,
            position_changes=position_changes,
            note="Coordinator compose failed after one retry; deterministic classification ledger rendered instead.",
        )

    result = DeliberationResult(
        run_id=run_id,
        question=config.question,
        mode="standard",
        governance=governance,
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
        tooling=config.tool_trace_info(tool_tracker),
        alignment=alignment,
    )
    return _attach_v3_trace(result, expected_voter_count=len(config.analysis_models))


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
    try:
        normalize = await _call_coordinator_structured(
            client=client,
            model=coordinator,
            request=build_normalize_prompt(
                question=config.question,
                claims=claim_payload,
                topic=topic,
            ),
            schema=NormalizeResult,
            timeout=config.per_model_timeout,
            call_params=config.call_params_for_phase("normalize"),
        )
        normalize = _stamp_normalize(run_id, normalize, claims, topic.topic_id)
    except (CallBudgetExceededError, ToolCallBudgetExceededError):
        raise
    except Exception as error:
        failures["normalize"] = [
            PhaseFailure(model_id=coordinator, message=str(error))
        ]
        normalize = _fallback_normalize(run_id, claims, topic.topic_id)

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
    votes = _sanitize_vote_sets(
        [value for value in vote_outcome.values if isinstance(value, VoteSet)],
        {candidate.candidate_id for candidate in normalize.candidate_claims},
    )
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
        candidate_set_id=stable_candidate_set_id(
            run_id, "centralized", topic.topic_id
        ),
    )


async def run_planning_deliberation(
    config: DeliberationConfig, client: CompletionClient
) -> DeliberationResult:
    if config.mmd_mode != "planning":
        raise ValueError("run_planning_deliberation requires mmd_mode='planning'")
    validate_model_selection("planning", config.analysis_models, config.coordinator_model)
    governance = resolve_governance(
        config.mmd_mode, config.governance, config.experiment_manifest
    )

    usage_tracker = UsageTracker()
    client = UsageCollectingClient(client, usage_tracker)
    tool_tracker = ToolCallTracker()
    client = _apply_native_web_tools(client, config, tool_tracker)
    run_id = make_run_id()
    coordinator = config.coordinator_model or config.analysis_models[0]

    planning_phase_failures: dict[str, list[PhaseFailure]] = {}
    try:
        outline = await _call_coordinator_structured(
            client=client,
            model=coordinator,
            request=build_outline_prompt(
                question=config.question,
                max_topics=config.max_topics,
                conversation_context=config.conversation_context,
            ),
            schema=OutlineResult,
            timeout=config.per_model_timeout,
            call_params=config.call_params_for_phase("outline"),
        )
    except (CallBudgetExceededError, ToolCallBudgetExceededError):
        raise
    except Exception as error:
        planning_phase_failures["outline"] = [
            PhaseFailure(model_id=coordinator, message=str(error))
        ]
        outline = OutlineResult(topics=[])
    cross_cutting = Topic(
        topic_id="cross_cutting_risks_and_omissions",
        title="Cross-cutting risks and omissions",
        description="Risks, dependencies, interactions, and material omissions spanning multiple topics.",
    )
    outline = OutlineResult(
        topics=[
            *[
                topic
                for topic in outline.topics
                if topic.topic_id != cross_cutting.topic_id
            ][: max(0, config.max_topics - 1)],
            cross_cutting,
        ]
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

    candidates = [
        {
            "topic_id": topic_result.topic.topic_id,
            "candidate_id": candidate.candidate_id,
            "classification": topic_result.classifications[
                candidate.candidate_id
            ].label,
            "text": candidate.text,
        }
        for topic_result in topics
        for candidate in topic_result.normalize.candidate_claims
    ]
    compose_candidates = candidates
    topic_briefs_used = False
    context_budget_exceeded = False
    exceeds_context, context_profile = _global_compose_context_profile(
        client, coordinator, compose_candidates
    )
    if exceeds_context:
        topic_briefs_used = True
        compose_candidates = [
            {**candidate, "text": candidate["text"][:1_200]}
            for candidate in candidates
        ]
        context_budget_exceeded, compressed_profile = _global_compose_context_profile(
            client, coordinator, compose_candidates
        )
        context_profile = {
            **context_profile,
            "after_compression": compressed_profile,
        }

    allowed_ids = {candidate["candidate_id"] for candidate in candidates}
    strong_ids = {
        candidate["candidate_id"]
        for candidate in candidates
        if candidate["classification"] == "strong_consensus"
    }
    planning_failures: list[PhaseFailure] = []
    try:
        if context_budget_exceeded:
            raise ValueError(
                "GlobalCompose input remains over budget after one topic-brief compression"
            )
        planning_final = await _call_coordinator_structured(
            client=client,
            model=coordinator,
            request=build_global_compose_prompt(
                question=config.question,
                topics=[topic.topic for topic in topics],
                candidates=compose_candidates,
                conversation_context=config.conversation_context,
            ),
            schema=PlanningFinalAnswer,
            timeout=config.per_model_timeout,
            call_params=config.call_params_for_phase("global_compose"),
        )
        planning_final = planning_final.model_copy(
            update={
                "spans": [
                    span.model_copy(
                        update={
                            "span_id": f"{run_id}::output_span::{index:03d}"
                        }
                    )
                    for index, span in enumerate(planning_final.spans)
                ]
            }
        )
        cited: set[str] = set()
        for span in planning_final.spans:
            lineage = [
                *span.source_candidate_ids,
                *span.derived_from_candidate_ids,
            ]
            if not lineage or any(candidate_id not in allowed_ids for candidate_id in lineage):
                raise ValueError("GlobalCompose returned invalid or empty lineage")
            cited.update(lineage)
        omitted = {
            item.candidate_id
            for item in planning_final.omitted_strong_candidate_reasons
        }
        missing = strong_ids - cited - omitted
        if missing:
            raise ValueError(
                "GlobalCompose omitted strong candidate without reason: "
                + ", ".join(sorted(missing))
            )
    except (CallBudgetExceededError, ToolCallBudgetExceededError):
        raise
    except Exception as error:
        planning_failures.append(
            PhaseFailure(
                model_id=coordinator,
                message=str(error),
                code=(
                    "context_budget_exceeded"
                    if context_budget_exceeded
                    else "global_compose_failed"
                ),
            )
        )
        included = [
            candidate
            for candidate in candidates
            if candidate["classification"] != "rejected"
        ]
        fallback_candidates = included or candidates[:1]
        planning_final = PlanningFinalAnswer(
            final_answer="\n\n".join(
                f"## {topic_result.topic.title}\n\n"
                + (
                    "\n".join(
                        (
                            f"- Disputed: {candidate['text']}"
                            if candidate["classification"] == "disputed"
                            else f"- {candidate['text']}"
                        )
                        for candidate in included
                        if candidate["topic_id"] == topic_result.topic.topic_id
                    )
                    or "- No supported candidate reached consensus."
                )
                for topic_result in topics
            ),
            spans=[
                PlanningOutputSpan(
                    span_id=f"{run_id}::output_span::{index:03d}",
                    text=candidate["text"],
                    source_candidate_ids=[candidate["candidate_id"]],
                    lineage_kind="candidate",
                )
                for index, candidate in enumerate(fallback_candidates)
            ],
            omitted_strong_candidate_reasons=[
                {
                    "candidate_id": candidate_id,
                    "reason": "GlobalCompose failed; candidate remains in its topic ledger.",
                }
                for candidate_id in sorted(
                    strong_ids
                    - {candidate["candidate_id"] for candidate in fallback_candidates}
                )
            ],
        )

    sections: list[SectionAnswer] = []
    for topic_result in topics:
        strong, qualified, disputed, rejected = _consensus_buckets(
            topic_result.normalize, topic_result.classifications
        )
        topic_candidate_ids = {
            candidate.candidate_id
            for candidate in topic_result.normalize.candidate_claims
        }
        section_text = "\n\n".join(
            span.text
            for span in planning_final.spans
            if topic_candidate_ids.intersection(span.source_candidate_ids)
        ) or "No integrated output span was assigned to this topic."
        sections.append(
            SectionAnswer(
                topic_id=topic_result.topic.topic_id,
                title=topic_result.topic.title,
                tldr=(strong or qualified or ["No consensus reached."])[0],
                section_answer=section_text,
                strong_consensus=strong,
                qualified_consensus=qualified,
                disputed_points=disputed,
                rejected_or_unsupported=rejected,
                model_position_changes=_position_changes(
                    topic_result.proposals, topic_result.revisions
                ),
                confidence_summary={
                    "consensus_strength": "low" if disputed else "medium",
                    "notes": "Compatibility projection from mmd.v3 topic ledger and GlobalCompose lineage.",
                },
            )
        )
    executive_summary = planning_final.final_answer
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

    result = DeliberationResult(
        run_id=run_id,
        question=config.question,
        mode="planning",
        governance=governance,
        proposals=[],
        normalize=NormalizeResult(candidate_claims=[]),
        classifications={},
        final=final,
        quorum={},
        failures={
            **planning_phase_failures,
            **({"global_compose": planning_failures} if planning_failures else {}),
            **({"topic_brief": []} if topic_briefs_used else {}),
        },
        outline=outline,
        topics=topics,
        failed_topics=failed_topics,
        plan_document=plan_document,
        planning_final=planning_final,
        planning_context=context_profile,
        usage=usage_tracker.summary(),
        tooling=config.tool_trace_info(tool_tracker),
    )
    return _attach_v3_trace(result, expected_voter_count=len(config.analysis_models))


async def run_deliberation(
    config: DeliberationConfig, client: CompletionClient
) -> DeliberationResult:
    if config.max_total_calls is not None:
        client = CallLimitedClient(client, config.max_total_calls)

    policy_decision = resolve_deliberation_policy(
        config.deliberation_policy, config.question, config.conversation_context
    )

    async def run_selected() -> DeliberationResult:
        if not policy_decision.deliberated:
            return await _run_single_model_completion(config, client)
        if config.mmd_mode == "quick":
            return await run_quick_deliberation(config, client)
        if config.mmd_mode == "standard":
            return await run_standard_deliberation(config, client)
        if config.mmd_mode == "planning":
            return await run_planning_deliberation(config, client)
        raise NotImplementedError(f"unsupported mmd_mode: {config.mmd_mode}")

    if config.max_run_timeout is None:
        result = await run_selected()
    else:
        try:
            result = await asyncio.wait_for(
                run_selected(), timeout=config.max_run_timeout
            )
        except asyncio.TimeoutError as error:
            raise DeliberationTimeoutError(config.max_run_timeout) from error

    performance = _compute_performance_summary(result)
    result = result.model_copy(
        update={"policy": policy_decision, "performance": performance}
    )
    if result.trace is None:
        result = _attach_v3_trace(
            result, expected_voter_count=len(config.analysis_models)
        )
    if result.trace is not None:
        result.trace.extensions = {
            "policy": result.policy.model_dump(mode="json") if result.policy else None,
            "performance": (
                result.performance.model_dump(mode="json")
                if result.performance
                else None
            ),
            "tooling": result.tooling.model_dump(mode="json", exclude_none=True),
            "planning_context": result.planning_context,
        }
    return result

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

DeliberationPolicy = Literal["off", "required", "auto"]

DEFAULT_AUTO_LONG_QUESTION_WORDS = 20

_DECISION_MARKERS = (
    "should i",
    "should we",
    "which is better",
    "which one",
    "vs.",
    " vs ",
    "versus",
    "compare",
    "comparison",
    "trade-off",
    "tradeoff",
    "pros and cons",
    "recommend",
    "recommendation",
    "best approach",
    "best way",
    "opinion",
    "decide",
    "decision",
    "strategy",
    "worth it",
    "better option",
    "choose between",
    "which approach",
)


class AutoPolicyDecision(BaseModel):
    deliberate: bool
    reason: str
    signals: dict[str, Any] = Field(default_factory=dict)


class PolicyTraceInfo(BaseModel):
    policy: DeliberationPolicy
    deliberated: bool
    reason: str
    auto_signals: dict[str, Any] | None = None


def decide_auto_deliberation(
    question: str,
    conversation_context: str | None = None,
    *,
    long_question_words: int = DEFAULT_AUTO_LONG_QUESTION_WORDS,
) -> AutoPolicyDecision:
    """Deterministic, zero-cost heuristic for `deliberation_policy="auto"`.

    `conversation_context` is accepted for signature stability but deliberately not
    scored: treating "any prior turns exist" as a signal would make `auto` deliberate
    on nearly every multi-turn follow-up, defeating its purpose.
    """
    lowered = question.lower()
    word_count = len(question.split())
    is_long = word_count >= long_question_words
    matched_markers = [marker for marker in _DECISION_MARKERS if marker in lowered]

    signals = {
        "word_count": word_count,
        "is_long": is_long,
        "matched_markers": matched_markers,
    }

    if is_long:
        return AutoPolicyDecision(
            deliberate=True,
            reason=f"question is long ({word_count} words >= {long_question_words})",
            signals=signals,
        )
    if matched_markers:
        return AutoPolicyDecision(
            deliberate=True,
            reason="question contains decision/comparison language: "
            + ", ".join(matched_markers),
            signals=signals,
        )
    return AutoPolicyDecision(
        deliberate=False,
        reason="question is short and has no decision/comparison markers",
        signals=signals,
    )


def resolve_deliberation_policy(
    policy: DeliberationPolicy,
    question: str,
    conversation_context: str | None = None,
) -> PolicyTraceInfo:
    if policy == "off":
        return PolicyTraceInfo(
            policy=policy,
            deliberated=False,
            reason="deliberation_policy=off: single-model direct response requested",
        )
    if policy == "required":
        return PolicyTraceInfo(
            policy=policy,
            deliberated=True,
            reason="deliberation_policy=required: deliberation always runs",
        )
    decision = decide_auto_deliberation(question, conversation_context)
    return PolicyTraceInfo(
        policy=policy,
        deliberated=decision.deliberate,
        reason=decision.reason,
        auto_signals=decision.signals,
    )

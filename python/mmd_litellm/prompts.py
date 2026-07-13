from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field

from .schemas import (
    Critique,
    FinalAnswer,
    NormalizeResult,
    OutlineResult,
    Proposal,
    RevisionSet,
    SectionAnswer,
    Topic,
    VoteSet,
)


class CompletionRequest(BaseModel):
    system_prompt: str
    user_prompt: str
    meta: dict[str, Any]
    litellm_params: dict[str, Any] = Field(default_factory=dict)

    def to_messages(self) -> list[dict[str, str]]:
        return [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": self.user_prompt},
        ]

    def with_litellm_params(self, params: dict[str, Any]) -> CompletionRequest:
        if not params:
            return self
        return self.model_copy(
            update={"litellm_params": {**self.litellm_params, **params}}
        )


def describe_schema(schema: type[BaseModel], name: str) -> str:
    return json.dumps({name: schema.model_json_schema()}, indent=2, sort_keys=True)


def _topic_scope(topic: Topic | None) -> str:
    if topic is None:
        return ""
    return (
        f'Topic scope: "{topic.title}" - {topic.description}. '
        "Address only this topic and avoid claims about other topics."
    )


def build_propose_prompt(
    *,
    question: str,
    model_id: str,
    max_claims: int = 6,
    topic: Topic | None = None,
    conversation_context: str | None = None,
) -> CompletionRequest:
    scope = _topic_scope(topic)
    system_prompt = "\n\n".join(
        line
        for line in [
            "You are one of several independent models answering a user's question before a multi-model deliberation.",
            "Think independently. Do not try to predict or match what other models might say.",
            "A conversation context block, if present, is prior background only; the Question line is what you must actually answer."
            if conversation_context
            else "",
            scope,
            f"Break your answer into at most {max_claims} discrete claims.",
            "Each claim must be typed as fact, judgment, recommendation, assumption, or risk.",
            "Give each claim a confidence between 0 and 1, a rationale, and any conditions under which it holds.",
            "Do not state uncertain information as if it were settled fact; use the assumption or risk type and a lower confidence instead.",
            "Return ONLY JSON matching this schema, no prose outside the JSON:",
            describe_schema(Proposal, "Proposal"),
        ]
        if line
    )
    user_parts = []
    if conversation_context:
        user_parts.append(f"Conversation context so far:\n{conversation_context}")
    user_parts.append(f"Question: {question}")
    if scope:
        user_parts.append(scope)
    return CompletionRequest(
        system_prompt=system_prompt,
        user_prompt="\n\n".join(user_parts),
        meta={
            "phase": "propose",
            "question": question,
            "model_id": model_id,
            "topic_id": topic.topic_id if topic else None,
        },
    )


def build_normalize_prompt(
    *, question: str, claims: list[dict[str, Any]], topic: Topic | None = None
) -> CompletionRequest:
    scope = _topic_scope(topic)
    system_prompt = "\n\n".join(
        line
        for line in [
            "Merge semantically equivalent claims from different models into candidate consensus claims.",
            scope,
            "You are doing semantic grouping only; do not decide which claim is factually correct, and do not drop a claim's substance to force a merge.",
            "Every candidate claim must list source_claim_ids for every original claim it merges, at least one and never empty.",
            "If a claim does not overlap with any other, it still becomes its own candidate with a single source_claim_id.",
            "Return ONLY JSON matching this schema, no prose outside the JSON:",
            describe_schema(NormalizeResult, "NormalizeResult"),
        ]
        if line
    )
    user_parts = [
        f"Question: {question}",
        "All claims across all models (post-revision):",
        json.dumps(claims, indent=2),
    ]
    if scope:
        user_parts.insert(1, scope)
    return CompletionRequest(
        system_prompt=system_prompt,
        user_prompt="\n\n".join(user_parts),
        meta={
            "phase": "normalize",
            "question": question,
            "claims": claims,
            "topic_id": topic.topic_id if topic else None,
        },
    )


def build_critique_prompt(
    *,
    question: str,
    reviewer_model_id: str,
    proposals: list[Proposal],
    topic: Topic | None = None,
) -> CompletionRequest:
    scope = _topic_scope(topic)
    targets = [
        {
            "claim_id": claim.claim_id,
            "text": claim.text,
            "model_id": proposal.model_id,
        }
        for proposal in proposals
        for claim in proposal.claims
        if proposal.model_id != reviewer_model_id
    ]
    system_prompt = "\n\n".join(
        line
        for line in [
            "You are reviewing claims proposed by other independent models in a multi-model deliberation.",
            scope,
            "For each claim from another model, decide: support, challenge, or refine.",
            "Every challenge must include a concrete reason; do not challenge a claim just because of phrasing or style differences.",
            "Rate severity as minor, major, or critical, reflecting how much the claim would change the final answer if the challenge were ignored.",
            "You do not need to review your own claims; they have been excluded from the list below.",
            "Return ONLY JSON matching this schema, no prose outside the JSON:",
            describe_schema(Critique, "Critique"),
        ]
        if line
    )
    user_parts = [
        f"Question: {question}",
        "Claims to review:",
        json.dumps(targets, indent=2),
    ]
    if scope:
        user_parts.insert(1, scope)
    return CompletionRequest(
        system_prompt=system_prompt,
        user_prompt="\n\n".join(user_parts),
        meta={
            "phase": "critique",
            "reviewer_model_id": reviewer_model_id,
            "targets": targets,
            "topic_id": topic.topic_id if topic else None,
        },
    )


def build_revise_prompt(
    *,
    question: str,
    model_id: str,
    own_claims: list[dict[str, Any]],
    reviews_on_mine: list[dict[str, Any]],
) -> CompletionRequest:
    system_prompt = "\n\n".join(
        [
            "Other models have reviewed your claims from the previous round. Decide, per claim, whether to keep, revise, withdraw, or adopt another model's position.",
            "You must explicitly say whether you were persuaded by a specific review, citing it via influenced_by.",
            "Do not abandon an objection you still believe is important just to reach agreement; disagreement is a legitimate outcome.",
            "Return ONLY JSON matching this schema, no prose outside the JSON:",
            describe_schema(RevisionSet, "RevisionSet"),
        ]
    )
    return CompletionRequest(
        system_prompt=system_prompt,
        user_prompt="\n\n".join(
            [
                f"Question: {question}",
                "Your claims from the previous round:",
                json.dumps(own_claims, indent=2),
                "Reviews you received:",
                json.dumps(reviews_on_mine, indent=2),
            ]
        ),
        meta={
            "phase": "revise",
            "model_id": model_id,
            "own_claims": [
                {"claim_id": claim["claim_id"], "text": claim["text"]}
                for claim in own_claims
            ],
            "reviews": [
                {
                    "reviewer_model_id": review["reviewer_model_id"],
                    "target_claim_id": review["target_claim_id"],
                    "stance": review["stance"],
                }
                for review in reviews_on_mine
            ],
        },
    )


def build_vote_prompt(
    *, question: str, model_id: str, candidates: list[dict[str, str]]
) -> CompletionRequest:
    system_prompt = "\n\n".join(
        [
            "Vote on each candidate consensus claim.",
            "Distinguish approve from approve_with_conditions; use the latter when you would only accept it with a stated caveat.",
            "If you vote object, you must also set objection_severity (minor, major, or critical) and explain in reason why this blocks the main conclusion.",
            "Abstain only when you have no informed opinion, not as a way to avoid taking a position.",
            "Return ONLY JSON matching this schema, no prose outside the JSON:",
            describe_schema(VoteSet, "VoteSet"),
        ]
    )
    return CompletionRequest(
        system_prompt=system_prompt,
        user_prompt="\n\n".join(
            [
                f"Question: {question}",
                "Candidates:",
                json.dumps(candidates, indent=2),
            ]
        ),
        meta={"phase": "vote", "model_id": model_id, "candidates": candidates},
    )


def build_compose_prompt(
    *,
    question: str,
    strong_consensus: list[str],
    qualified_consensus: list[str],
    disputed: list[str],
    rejected: list[str],
    position_changes: list[dict[str, str]],
) -> CompletionRequest:
    system_prompt = "\n\n".join(
        [
            "You are an editor, not a judge. You may only use the consensus classification given below; do not introduce new claims and do not resolve disputed points yourself.",
            "strong_consensus items go into the main conclusion.",
            "qualified_consensus items go into a conditional-conclusion section.",
            "disputed_points must be presented as open disagreement or uncertainty, never resolved.",
            "rejected_or_unsupported items must not appear in the main conclusion.",
            "Return ONLY JSON matching this schema, no prose outside the JSON:",
            describe_schema(FinalAnswer, "FinalAnswer"),
        ]
    )
    return CompletionRequest(
        system_prompt=system_prompt,
        user_prompt="\n\n".join(
            [
                f"Question: {question}",
                f"strong_consensus: {json.dumps(strong_consensus)}",
                f"qualified_consensus: {json.dumps(qualified_consensus)}",
                f"disputed: {json.dumps(disputed)}",
                f"rejected: {json.dumps(rejected)}",
                f"model_position_changes: {json.dumps(position_changes)}",
            ]
        ),
        meta={
            "phase": "compose",
            "question": question,
            "strong_consensus": strong_consensus,
            "qualified_consensus": qualified_consensus,
            "disputed": disputed,
            "rejected": rejected,
            "position_changes": position_changes,
        },
    )


def build_outline_prompt(
    *,
    question: str,
    max_topics: int = 8,
    conversation_context: str | None = None,
) -> CompletionRequest:
    system_prompt = "\n\n".join(
        line
        for line in [
            "Break the following question/request down into a bounded list of distinct topics to structure a multi-model deliberation around.",
            "A conversation context block, if present, is prior background only; the Question line is what you must actually decompose into topics."
            if conversation_context
            else "",
            f"Produce at most {max_topics} topics.",
            "Each topic must be a genuinely separate decision area; do not split one decision into multiple overlapping topics.",
            "Give each topic a short title and a one-sentence description of its scope, precise enough that a model addressing only that topic knows what is and is not in scope.",
            "If the question is narrow enough to need only one topic, return exactly one topic covering it.",
            "Return ONLY JSON matching this schema, no prose outside the JSON:",
            describe_schema(OutlineResult, "OutlineResult"),
        ]
        if line
    )
    user_parts = []
    if conversation_context:
        user_parts.append(f"Conversation context so far:\n{conversation_context}")
    user_parts.append(f"Question: {question}")
    return CompletionRequest(
        system_prompt=system_prompt,
        user_prompt="\n\n".join(user_parts),
        meta={"phase": "outline", "question": question, "max_topics": max_topics},
    )


def build_section_compose_prompt(
    *,
    question: str,
    topic: Topic,
    strong_consensus: list[str],
    qualified_consensus: list[str],
    disputed: list[str],
    rejected: list[str],
    position_changes: list[dict[str, str]],
) -> CompletionRequest:
    system_prompt = "\n\n".join(
        [
            "You are an editor, not a judge, writing one section of a larger multi-topic plan document.",
            f'This section covers only the topic "{topic.title}" - {topic.description}. Do not discuss other topics.',
            "You may only use the consensus classification given below; do not introduce new claims and do not resolve disputed points yourself.",
            "strong_consensus items go into the main conclusion for this section.",
            "qualified_consensus items go into a conditional-conclusion part of this section.",
            "disputed_points must be presented as open disagreement or uncertainty, never resolved.",
            "rejected_or_unsupported items must not appear in the main conclusion.",
            'tldr must be exactly one sentence summarizing this section conclusion; it must stand alone without referring to "this section" or other topics.',
            "Return ONLY JSON matching this schema, no prose outside the JSON:",
            describe_schema(SectionAnswer, "SectionAnswer"),
        ]
    )
    return CompletionRequest(
        system_prompt=system_prompt,
        user_prompt="\n\n".join(
            [
                f"Question: {question}",
                f"Topic: {topic.title} - {topic.description}",
                f"strong_consensus: {json.dumps(strong_consensus)}",
                f"qualified_consensus: {json.dumps(qualified_consensus)}",
                f"disputed: {json.dumps(disputed)}",
                f"rejected: {json.dumps(rejected)}",
                f"model_position_changes: {json.dumps(position_changes)}",
            ]
        ),
        meta={
            "phase": "section_compose",
            "question": question,
            "topic_id": topic.topic_id,
            "topic_title": topic.title,
            "strong_consensus": strong_consensus,
            "qualified_consensus": qualified_consensus,
            "disputed": disputed,
            "rejected": rejected,
            "position_changes": position_changes,
        },
    )


def build_direct_answer_prompt(
    *,
    question: str,
    conversation_context: str | None = None,
) -> CompletionRequest:
    """Plain-text prompt for `deliberation_policy="off"`'s single-model bypass.

    Deliberately has no JSON schema instruction, unlike every other builder in this
    module: this path exists to be the cheapest possible answer, not another
    structured-output round trip.
    """
    system_prompt = "\n\n".join(
        line
        for line in [
            "You are answering a user's question directly. No multi-model deliberation is being run for this request.",
            "A conversation context block, if present, is prior background only; the Question line is what you must actually answer."
            if conversation_context
            else "",
            "Answer directly and concisely in plain text. Do not output JSON.",
        ]
        if line
    )
    user_parts = []
    if conversation_context:
        user_parts.append(f"Conversation context so far:\n{conversation_context}")
    user_parts.append(f"Question: {question}")
    return CompletionRequest(
        system_prompt=system_prompt,
        user_prompt="\n\n".join(user_parts),
        meta={"phase": "direct_answer", "question": question},
    )

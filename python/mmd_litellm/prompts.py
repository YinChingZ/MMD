from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel

from .schemas import FinalAnswer, NormalizeResult, Proposal


class CompletionRequest(BaseModel):
    system_prompt: str
    user_prompt: str
    meta: dict[str, Any]

    def to_messages(self) -> list[dict[str, str]]:
        return [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": self.user_prompt},
        ]


def describe_schema(schema: type[BaseModel], name: str) -> str:
    return json.dumps({name: schema.model_json_schema()}, indent=2, sort_keys=True)


def build_propose_prompt(
    *, question: str, model_id: str, max_claims: int = 6
) -> CompletionRequest:
    system_prompt = "\n\n".join(
        [
            "You are one of several independent models answering a user's question before a multi-model deliberation.",
            "Think independently. Do not try to predict or match what other models might say.",
            f"Break your answer into at most {max_claims} discrete claims.",
            "Each claim must be typed as fact, judgment, recommendation, assumption, or risk.",
            "Give each claim a confidence between 0 and 1, a rationale, and any conditions under which it holds.",
            "Do not state uncertain information as if it were settled fact; use the assumption or risk type and a lower confidence instead.",
            "Return ONLY JSON matching this schema, no prose outside the JSON:",
            describe_schema(Proposal, "Proposal"),
        ]
    )
    return CompletionRequest(
        system_prompt=system_prompt,
        user_prompt=f"Question: {question}",
        meta={"phase": "propose", "question": question, "model_id": model_id},
    )


def build_normalize_prompt(
    *, question: str, claims: list[dict[str, str]]
) -> CompletionRequest:
    system_prompt = "\n\n".join(
        [
            "Merge semantically equivalent claims from different models into candidate consensus claims.",
            "You are doing semantic grouping only; do not decide which claim is factually correct, and do not drop a claim's substance to force a merge.",
            "Every candidate claim must list source_claim_ids for every original claim it merges, at least one and never empty.",
            "If a claim does not overlap with any other, it still becomes its own candidate with a single source_claim_id.",
            "Return ONLY JSON matching this schema, no prose outside the JSON:",
            describe_schema(NormalizeResult, "NormalizeResult"),
        ]
    )
    return CompletionRequest(
        system_prompt=system_prompt,
        user_prompt="\n\n".join(
            [
                f"Question: {question}",
                "All claims across all models (post-revision):",
                json.dumps(claims, indent=2),
            ]
        ),
        meta={"phase": "normalize", "question": question, "claims": claims},
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


from __future__ import annotations

import json

from .litellm_provider import MMDLiteLLMProvider
from .prompts import CompletionRequest


class ScriptedCompletionClient:
    """Deterministic model client for local LiteLLM Proxy smoke tests."""

    async def acomplete(
        self,
        model: str,
        request: CompletionRequest,
        *,
        timeout: float | None = None,
    ) -> str:
        phase = request.meta["phase"]
        if phase == "propose":
            return json.dumps(
                {
                    "model_id": "model-invented-by-llm",
                    "answer_summary": f"{model} summary",
                    "claims": [
                        {
                            "claim_id": "invented-c1",
                            "text": "Use the LiteLLM-shaped Python provider as the integration path.",
                            "type": "recommendation",
                            "confidence": 0.92,
                            "rationale": "It exercises the same custom provider interface the proxy will use.",
                            "conditions": [],
                        }
                    ],
                    "assumptions": [],
                    "risks": [],
                }
            )
        if phase == "critique":
            return json.dumps(
                {
                    "reviewer_model_id": "reviewer-invented-by-llm",
                    "reviews": [
                        {
                            "target_claim_id": target["claim_id"],
                            "stance": "support",
                            "severity": "minor",
                            "comment": "The claim is compatible with the integration goal.",
                        }
                        for target in request.meta["targets"]
                    ],
                }
            )
        if phase == "revise":
            return json.dumps(
                {
                    "model_id": "revision-model-invented-by-llm",
                    "revisions": [
                        {
                            "original_claim_id": claim["claim_id"],
                            "decision": "keep",
                            "confidence": 0.9,
                            "reason_for_change": "No review required a change.",
                            "influenced_by": [],
                        }
                        for claim in request.meta["own_claims"]
                    ],
                }
            )
        if phase == "normalize":
            claims = request.meta["claims"]
            return json.dumps(
                {
                    "candidate_claims": [
                        {
                            "candidate_id": "candidate_1",
                            "text": "Use the LiteLLM-shaped Python provider as the integration path.",
                            "source_claim_ids": [claim["claim_id"] for claim in claims],
                        }
                    ]
                }
            )
        if phase == "vote":
            return json.dumps(
                {
                    "model_id": "vote-model-invented-by-llm",
                    "votes": [
                        {
                            "candidate_id": candidate["candidate_id"],
                            "vote": "approve",
                            "confidence": 0.9,
                            "reason": "This is acceptable for the proxy smoke test.",
                        }
                        for candidate in request.meta["candidates"]
                    ],
                }
            )
        if phase == "compose":
            return json.dumps(
                {
                    "final_answer": "Use the LiteLLM-shaped Python provider as the integration path.",
                    "strong_consensus": request.meta["strong_consensus"],
                    "qualified_consensus": request.meta["qualified_consensus"],
                    "disputed_points": request.meta["disputed"],
                    "rejected_or_unsupported": request.meta["rejected"],
                    "model_position_changes": [],
                    "confidence_summary": {
                        "consensus_strength": "high",
                        "notes": "The scripted panel converged.",
                    },
                }
            )
        raise ValueError(f"unexpected phase: {phase}")


mmd_custom_llm = MMDLiteLLMProvider(client=ScriptedCompletionClient())


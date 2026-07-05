import asyncio
import json

import pytest

from mmd_litellm.orchestrator import (
    DeliberationConfig,
    QuorumNotMetError,
    run_quick_deliberation,
)


class ScriptedClient:
    def __init__(self, fail_models: set[str] | None = None) -> None:
        self.fail_models = fail_models or set()

    async def acomplete(self, model, request, *, timeout=None):
        phase = request.meta["phase"]
        if phase == "propose" and model in self.fail_models:
            raise RuntimeError(f"{model} is unavailable")
        if phase == "propose":
            return json.dumps(
                {
                    "model_id": "model-invented-by-llm",
                    "answer_summary": f"{model} summary",
                    "claims": [
                        {
                            "claim_id": "invented-c1",
                            "text": "Use a small TypeScript monorepo for this project.",
                            "type": "recommendation",
                            "confidence": 0.9,
                            "rationale": "It keeps shared protocol types near the CLI.",
                            "conditions": [],
                        }
                    ],
                    "assumptions": [],
                    "risks": [],
                }
            )
        if phase == "normalize":
            claims = request.meta["claims"]
            return json.dumps(
                {
                    "candidate_claims": [
                        {
                            "candidate_id": "candidate_1",
                            "text": "Use a small TypeScript monorepo for this project.",
                            "source_claim_ids": [claim["claim_id"] for claim in claims],
                        }
                    ]
                }
            )
        if phase == "compose":
            return json.dumps(
                {
                    "final_answer": "Use a small TypeScript monorepo for this project.",
                    "strong_consensus": request.meta["strong_consensus"],
                    "qualified_consensus": request.meta["qualified_consensus"],
                    "disputed_points": request.meta["disputed"],
                    "rejected_or_unsupported": request.meta["rejected"],
                    "model_position_changes": [],
                    "confidence_summary": {
                        "consensus_strength": "high",
                        "notes": "All responding models converged.",
                    },
                }
            )
        raise AssertionError(f"unexpected phase: {phase}")


def test_quick_mode_runs_and_classifies_source_coverage():
    result = asyncio.run(
        run_quick_deliberation(
            DeliberationConfig(
                question="What should we build next?",
                analysis_models=["model_a", "model_b"],
            ),
            ScriptedClient(),
        )
    )

    assert result.final.final_answer == "Use a small TypeScript monorepo for this project."
    assert result.quorum["propose"].partial is False
    assert result.classifications["candidate_1"].label == "strong_consensus"
    assert result.proposals[0].model_id == "model_a"
    assert result.proposals[0].claims[0].claim_id.startswith(f"{result.run_id}:")


def test_quick_mode_degrades_when_quorum_is_met_but_partial():
    result = asyncio.run(
        run_quick_deliberation(
            DeliberationConfig(
                question="What should we build next?",
                analysis_models=["model_a", "model_b", "model_c"],
            ),
            ScriptedClient(fail_models={"model_c"}),
        )
    )

    assert result.quorum["propose"].met is True
    assert result.quorum["propose"].partial is True
    assert result.classifications["candidate_1"].label == "qualified_consensus"
    assert result.failures["propose"][0].model_id == "model_c"


def test_quick_mode_raises_when_quorum_is_not_met():
    with pytest.raises(QuorumNotMetError):
        asyncio.run(
            run_quick_deliberation(
                DeliberationConfig(
                    question="What should we build next?",
                    analysis_models=["model_a", "model_b", "model_c"],
                ),
                ScriptedClient(fail_models={"model_b", "model_c"}),
            )
        )


def test_config_rejects_recursive_mmd_models():
    with pytest.raises(ValueError):
        DeliberationConfig(
            question="Loop?",
            analysis_models=["openai/gpt-4.1", "mmd/fusion"],
        )


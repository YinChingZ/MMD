import asyncio
import json

import pytest

from mmd_litellm.orchestrator import (
    DeliberationConfig,
    QuorumNotMetError,
    run_deliberation,
    run_quick_deliberation,
    run_standard_deliberation,
)


class ScriptedClient:
    def __init__(
        self,
        fail_models: set[str] | None = None,
        fail_by_phase: dict[str, set[str]] | None = None,
        fail_topics_by_phase: dict[str, set[str]] | None = None,
        objecting_vote_models: set[str] | None = None,
    ) -> None:
        self.fail_models = fail_models or set()
        self.fail_by_phase = fail_by_phase or {}
        self.fail_topics_by_phase = fail_topics_by_phase or {}
        self.objecting_vote_models = objecting_vote_models or set()

    async def acomplete(self, model, request, *, timeout=None):
        phase = request.meta["phase"]
        if phase == "propose" and model in self.fail_models:
            raise RuntimeError(f"{model} is unavailable")
        if model in self.fail_by_phase.get(phase, set()):
            raise RuntimeError(f"{model} is unavailable")
        if request.meta.get("topic_id") in self.fail_topics_by_phase.get(phase, set()):
            raise RuntimeError(f"{request.meta['topic_id']} topic is unavailable")
        if phase == "outline":
            return json.dumps(
                {
                    "topics": [
                        {
                            "topic_id": "backend",
                            "title": "Backend",
                            "description": "Choose the backend shape and shared code boundaries.",
                        },
                        {
                            "topic_id": "deployment",
                            "title": "Deployment",
                            "description": "Choose a simple deployment path.",
                        },
                    ]
                }
            )
        if phase == "propose":
            topic_id = request.meta.get("topic_id")
            topic_prefix = f"{topic_id}: " if topic_id else ""
            return json.dumps(
                {
                    "model_id": "model-invented-by-llm",
                    "answer_summary": f"{topic_prefix}{model} summary",
                    "claims": [
                        {
                            "claim_id": "invented-c1",
                            "text": f"{topic_prefix}Use a small TypeScript monorepo for this project.",
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
        if phase == "critique":
            return json.dumps(
                {
                    "reviewer_model_id": "reviewer-invented-by-llm",
                    "reviews": [
                        {
                            "target_claim_id": target["claim_id"],
                            "stance": "support",
                            "severity": "minor",
                            "comment": "This claim is compatible with the evidence.",
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
                            "text": claims[0]["text"],
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
                            "vote": "object",
                            "confidence": 0.8,
                            "reason": "This should remain open for this test.",
                            "objection_severity": "major",
                        }
                        if model in self.objecting_vote_models
                        else {
                            "candidate_id": candidate["candidate_id"],
                            "vote": "approve",
                            "confidence": 0.9,
                            "reason": "This is acceptable.",
                        }
                        for candidate in request.meta["candidates"]
                    ],
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
        if phase == "section_compose":
            title = request.meta["topic_title"]
            strong = request.meta["strong_consensus"]
            return json.dumps(
                {
                    "topic_id": "topic-id-invented-by-llm",
                    "title": f"{title} invented",
                    "tldr": f"{title}: {strong[0]}",
                    "section_answer": f"{title} should follow the consensus recommendation.",
                    "strong_consensus": strong,
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


def test_standard_mode_runs_full_protocol_with_explicit_votes():
    result = asyncio.run(
        run_standard_deliberation(
            DeliberationConfig(
                question="What should we build next?",
                analysis_models=["model_a", "model_b", "model_c"],
                mmd_mode="standard",
            ),
            ScriptedClient(objecting_vote_models={"model_c"}),
        )
    )

    assert result.mode == "standard"
    assert len(result.critiques) == 3
    assert len(result.revisions) == 3
    assert len(result.votes) == 3
    assert result.critiques[0].reviewer_model_id == "model_a"
    assert result.votes[2].model_id == "model_c"
    assert result.classifications["candidate_1"].label == "disputed"
    assert result.final.disputed_points == [
        "Use a small TypeScript monorepo for this project."
    ]


def test_standard_mode_marks_vote_partial_when_quorum_is_met():
    result = asyncio.run(
        run_standard_deliberation(
            DeliberationConfig(
                question="What should we build next?",
                analysis_models=["model_a", "model_b", "model_c"],
                mmd_mode="standard",
            ),
            ScriptedClient(fail_by_phase={"vote": {"model_c"}}),
        )
    )

    assert result.quorum["vote"].met is True
    assert result.quorum["vote"].partial is True
    assert result.classifications["candidate_1"].partial is True
    assert result.classifications["candidate_1"].label == "qualified_consensus"


def test_standard_mode_raises_when_critique_quorum_is_not_met():
    with pytest.raises(QuorumNotMetError):
        asyncio.run(
            run_standard_deliberation(
                DeliberationConfig(
                    question="What should we build next?",
                    analysis_models=["model_a", "model_b", "model_c"],
                    mmd_mode="standard",
                ),
                ScriptedClient(fail_by_phase={"critique": {"model_b", "model_c"}}),
            )
        )


def test_run_deliberation_dispatches_standard_mode():
    result = asyncio.run(
        run_deliberation(
            DeliberationConfig(
                question="What should we build next?",
                analysis_models=["model_a", "model_b"],
                mmd_mode="standard",
            ),
            ScriptedClient(),
        )
    )

    assert result.mode == "standard"


def test_planning_mode_runs_per_topic_standard_and_composes_plan():
    result = asyncio.run(
        run_deliberation(
            DeliberationConfig(
                question="Plan the next milestone.",
                analysis_models=["model_a", "model_b"],
                mmd_mode="planning",
            ),
            ScriptedClient(),
        )
    )

    assert result.mode == "planning"
    assert result.outline is not None
    assert len(result.topics) == 2
    assert result.plan_document is not None
    assert result.plan_document.sections[0].topic_id == "backend"
    assert result.plan_document.sections[0].title == "Backend"
    assert "Backend:" in result.plan_document.executive_summary
    assert result.topics[0].proposals[0].claims[0].topic_id == "backend"
    assert result.topics[0].proposals[0].claims[0].claim_id.endswith(
        ":backend::model_a::c0"
    )


def test_planning_mode_keeps_partial_plan_when_one_topic_fails_quorum():
    result = asyncio.run(
        run_deliberation(
            DeliberationConfig(
                question="Plan the next milestone.",
                analysis_models=["model_a", "model_b"],
                mmd_mode="planning",
            ),
            ScriptedClient(fail_topics_by_phase={"critique": {"backend"}}),
        )
    )

    assert result.mode == "planning"
    assert [failed.topic.topic_id for failed in result.failed_topics] == ["backend"]
    assert len(result.topics) == 1
    assert result.plan_document is not None

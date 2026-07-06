import asyncio
import json

import pytest

from mmd_litellm.client import CompletionOutput, TokenUsage
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


class UsageScriptedClient(ScriptedClient):
    def __init__(
        self,
        *,
        usage: TokenUsage | None = None,
        missing_usage_phases: set[str] | None = None,
        invalid_json_once: set[tuple[str, str]] | None = None,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        self.usage = usage or TokenUsage(
            prompt_tokens=1,
            completion_tokens=2,
            total_tokens=3,
        )
        self.missing_usage_phases = missing_usage_phases or set()
        self.invalid_json_once = invalid_json_once or set()
        self.seen_invalid_json: set[tuple[str, str]] = set()

    async def acomplete(self, model, request, *, timeout=None):
        phase = request.meta["phase"]
        key = (phase, model)
        if key in self.invalid_json_once and key not in self.seen_invalid_json:
            self.seen_invalid_json.add(key)
            text = "{not valid json"
        else:
            text = await super().acomplete(model, request, timeout=timeout)
        usage = None if phase in self.missing_usage_phases else self.usage
        return CompletionOutput(text=text, usage=usage)


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
    assert result.usage.usage_unavailable is True


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


def test_quick_mode_aggregates_usage_for_successful_calls():
    result = asyncio.run(
        run_quick_deliberation(
            DeliberationConfig(
                question="What should we build next?",
                analysis_models=["model_a", "model_b"],
            ),
            UsageScriptedClient(),
        )
    )

    assert result.usage.openai_usage() == {
        "prompt_tokens": 4,
        "completion_tokens": 8,
        "total_tokens": 12,
    }
    assert result.usage.usage_unavailable is False
    assert [event.phase for event in result.usage.events] == [
        "propose",
        "propose",
        "normalize",
        "compose",
    ]


def test_quick_mode_marks_missing_usage_without_blocking_response():
    result = asyncio.run(
        run_quick_deliberation(
            DeliberationConfig(
                question="What should we build next?",
                analysis_models=["model_a", "model_b"],
            ),
            UsageScriptedClient(missing_usage_phases={"normalize"}),
        )
    )

    assert result.final.final_answer == "Use a small TypeScript monorepo for this project."
    assert result.usage.openai_usage() == {
        "prompt_tokens": 3,
        "completion_tokens": 6,
        "total_tokens": 9,
    }
    assert result.usage.usage_unavailable is True
    assert result.usage.usage_unavailable_count == 1


def test_structured_repair_attempt_usage_is_counted():
    result = asyncio.run(
        run_quick_deliberation(
            DeliberationConfig(
                question="What should we build next?",
                analysis_models=["model_a", "model_b"],
                max_repair_attempts=1,
            ),
            UsageScriptedClient(invalid_json_once={("propose", "model_a")}),
        )
    )

    assert result.usage.openai_usage() == {
        "prompt_tokens": 5,
        "completion_tokens": 10,
        "total_tokens": 15,
    }
    assert [event.phase for event in result.usage.events].count("propose") == 3


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


def test_config_applies_preset_model_cap_and_timeout_defaults():
    config = DeliberationConfig(
        question="What should we build next?",
        analysis_models=["model_a", "model_b", "model_c", "model_d"],
        preset="balanced",
    )

    assert config.analysis_models == ["model_a", "model_b", "model_c"]
    assert config.max_analysis_models == 3
    assert config.per_model_timeout == 60.0


def test_config_uses_mode_specific_timeout_without_preset():
    quick = DeliberationConfig(
        question="What should we build next?",
        analysis_models=["model_a", "model_b"],
    )
    standard = DeliberationConfig(
        question="What should we build next?",
        analysis_models=["model_a", "model_b"],
        mmd_mode="standard",
    )
    planning = DeliberationConfig(
        question="What should we build next?",
        analysis_models=["model_a", "model_b"],
        mmd_mode="planning",
    )

    assert quick.per_model_timeout == 40.0
    assert standard.per_model_timeout == 90.0
    assert planning.per_model_timeout == 120.0


def test_config_builds_role_specific_litellm_call_params():
    config = DeliberationConfig(
        question="What should we build next?",
        analysis_models=["model_a", "model_b"],
        max_completion_tokens=512,
        temperature=0.7,
        reasoning={"effort": "low"},
        model_params={"extra_body": {"provider_flag": True}},
        analysis_model_params={"top_p": 0.9},
        coordinator_model_params={"seed": 42},
    )

    assert config.call_params_for_phase("propose") == {
        "extra_body": {"provider_flag": True},
        "max_completion_tokens": 512,
        "reasoning": {"effort": "low"},
        "temperature": 0.7,
        "top_p": 0.9,
    }
    assert config.call_params_for_phase("compose") == {
        "extra_body": {"provider_flag": True},
        "max_completion_tokens": 512,
        "reasoning": {"effort": "low"},
        "temperature": 0.1,
        "seed": 42,
    }


def test_config_forwards_tools_to_panel_by_default():
    tool = {
        "type": "function",
        "function": {
            "name": "search",
            "description": "Search provider-managed context.",
            "parameters": {"type": "object", "properties": {}},
        },
    }
    config = DeliberationConfig(
        question="What should we build next?",
        analysis_models=["model_a", "model_b"],
        tools=[tool],
        tool_choice="auto",
        max_tool_calls=2,
    )

    panel_params = config.call_params_for_phase("propose")
    coordinator_params = config.call_params_for_phase("compose")
    assert panel_params["tools"] == [tool]
    assert panel_params["tool_choice"] == "auto"
    assert panel_params["max_tool_calls"] == 2
    assert "tools" not in coordinator_params
    assert config.tool_trace_info().model_dump(exclude_none=True) == {
        "enabled_for_panel": True,
        "enabled_for_coordinator": False,
        "tool_count": 1,
        "tool_choice": "auto",
        "max_tool_calls": 2,
    }


def test_config_can_enable_tools_for_coordinator():
    tool = {
        "type": "function",
        "function": {
            "name": "search",
            "description": "Search provider-managed context.",
            "parameters": {"type": "object", "properties": {}},
        },
    }
    config = DeliberationConfig(
        question="What should we build next?",
        analysis_models=["model_a", "model_b"],
        tools=[tool],
        coordinator_tools_enabled=True,
    )

    assert config.call_params_for_phase("compose")["tools"] == [tool]
    assert config.tool_trace_info().enabled_for_coordinator is True


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


def test_standard_mode_aggregates_usage_for_all_phases():
    result = asyncio.run(
        run_standard_deliberation(
            DeliberationConfig(
                question="What should we build next?",
                analysis_models=["model_a", "model_b", "model_c"],
                mmd_mode="standard",
            ),
            UsageScriptedClient(),
        )
    )

    assert result.usage.openai_usage() == {
        "prompt_tokens": 14,
        "completion_tokens": 28,
        "total_tokens": 42,
    }
    assert [event.phase for event in result.usage.events].count("propose") == 3
    assert [event.phase for event in result.usage.events].count("critique") == 3
    assert [event.phase for event in result.usage.events].count("revise") == 3
    assert [event.phase for event in result.usage.events].count("normalize") == 1
    assert [event.phase for event in result.usage.events].count("vote") == 3
    assert [event.phase for event in result.usage.events].count("compose") == 1


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


def test_standard_mode_partial_failures_only_count_successful_usage():
    result = asyncio.run(
        run_standard_deliberation(
            DeliberationConfig(
                question="What should we build next?",
                analysis_models=["model_a", "model_b", "model_c"],
                mmd_mode="standard",
            ),
            UsageScriptedClient(fail_by_phase={"vote": {"model_c"}}),
        )
    )

    assert result.usage.openai_usage() == {
        "prompt_tokens": 13,
        "completion_tokens": 26,
        "total_tokens": 39,
    }
    assert len(result.failures["vote"]) == 1


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


def test_planning_mode_aggregates_outline_topic_and_section_usage():
    result = asyncio.run(
        run_deliberation(
            DeliberationConfig(
                question="Plan the next milestone.",
                analysis_models=["model_a", "model_b"],
                mmd_mode="planning",
            ),
            UsageScriptedClient(),
        )
    )

    assert result.usage.openai_usage() == {
        "prompt_tokens": 21,
        "completion_tokens": 42,
        "total_tokens": 63,
    }
    phases = [event.phase for event in result.usage.events]
    assert phases.count("outline") == 1
    assert phases.count("propose") == 4
    assert phases.count("critique") == 4
    assert phases.count("revise") == 4
    assert phases.count("normalize") == 2
    assert phases.count("vote") == 4
    assert phases.count("section_compose") == 2


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

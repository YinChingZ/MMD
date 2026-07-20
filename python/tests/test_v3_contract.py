import json
from itertools import permutations
from pathlib import Path

import pytest

from mmd_litellm.alignment import PairSupport, deterministic_complete_link
from mmd_litellm.consensus import classify_candidate
from mmd_litellm.ids import (
    stable_call_id,
    stable_candidate_id,
    stable_candidate_set_id,
)
from mmd_litellm.quorum import check_quorum
from mmd_litellm.schemas import Ballot
from mmd_litellm.v3 import (
    ExperimentManifest,
    ProtocolConfigurationError,
    resolve_governance,
    validate_model_selection,
)


FIXTURE = json.loads(
    (
        Path(__file__).resolve().parents[2]
        / "contract"
        / "mmd-protocol-v3"
        / "fixtures"
        / "parity-golden.json"
    ).read_text(encoding="utf-8")
)
SCENARIO_MATRIX = json.loads(
    (
        Path(__file__).resolve().parents[2]
        / "contract"
        / "mmd-protocol-v3"
        / "fixtures"
        / "scenario-matrix.json"
    ).read_text(encoding="utf-8")
)


def test_complete_shared_parity_scenario_matrix_is_frozen():
    assert SCENARIO_MATRIX["run_id"] == "run_fixture"
    assert SCENARIO_MATRIX["frozen_time"] == "2026-01-01T00:00:00.000Z"
    usage = SCENARIO_MATRIX["mock_usage"]
    assert usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"]
    assert [case["case_id"] for case in SCENARIO_MATRIX["cases"]] == [
        "quick_n2",
        "standard_c",
        "standard_d_equivalent",
        "standard_d_conflict_cannot_link",
        "standard_d_partial_quorum",
        "planning_normal",
        "planning_topic_brief_compression",
        "planning_global_compose_failure",
    ]


def test_quorum_and_classification_match_golden_vectors():
    for vector in FIXTURE["quorum"]:
        result = check_quorum(vector["respondent_count"], vector["model_count"])
        assert result.required == vector["required"]
        assert result.met is vector["met"]
        assert result.partial is vector["partial"]
    for vector in FIXTURE["classification"]:
        result = classify_candidate(
            [Ballot.model_validate(ballot) for ballot in vector["ballots"]],
            vector["expected_voter_count"],
        )
        assert result.label == vector["expected_label"]
        assert result.approve_ratio == pytest.approx(vector["expected_approve_ratio"])


def test_complete_link_is_order_independent_and_respects_cannot_link():
    alignment = FIXTURE["alignment"]
    support = [PairSupport(**pair) for pair in alignment["pair_support"]]
    expected = alignment["expected_clusters"]
    claim_ids = [claim["claim_id"] for claim in alignment["claims"]]
    for ordering in permutations(claim_ids):
        clusters, _ = deterministic_complete_link(
            list(ordering), list(reversed(support)), alignment["minimum_support"]
        )
        assert clusters == expected
        assert sorted(claim for cluster in clusters for claim in cluster) == sorted(
            claim_ids
        )
        assert not any("claim_a" in cluster and "claim_c" in cluster for cluster in clusters)


def test_stable_ids_match_cross_language_fixture():
    vector = FIXTURE["stable_ids"]
    assert (
        stable_candidate_set_id(
            vector["run_id"], "centralized", vector["topic_id"]
        )
        == vector["expected_candidate_set_id"]
    )
    assert [
        stable_candidate_id(vector["run_id"], index, vector["topic_id"])
        for index in range(2)
    ] == vector["expected_candidate_ids"]
    assert (
        stable_call_id(
            vector["run_id"], "vote", "model_a", 0, vector["topic_id"]
        )
        == vector["expected_call_id"]
    )


def test_governance_matrix_and_manifest_gate():
    with pytest.raises(ProtocolConfigurationError):
        resolve_governance("quick", "distributed", None)
    with pytest.raises(ProtocolConfigurationError):
        resolve_governance("standard", "distributed", None)
    manifest = ExperimentManifest(
        experiment_id="exp_1",
        alignment_policy={"version": "align.v1", "minimum_pair_support": 2},
    )
    assert resolve_governance("standard", "distributed", manifest) == "distributed"
    with pytest.raises(ProtocolConfigurationError):
        validate_model_selection("quick", ["a", "b", "c"], None)
    with pytest.raises(ProtocolConfigurationError):
        validate_model_selection("standard", ["a", "b"], "c")

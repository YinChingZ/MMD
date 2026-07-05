import pytest

from mmd_litellm.consensus import classify_candidate
from mmd_litellm.schemas import Ballot


def ballot(vote: str, **kwargs) -> Ballot:
    return Ballot(
        candidate_id="cc_1",
        vote=vote,
        confidence=0.8,
        reason="test",
        **kwargs,
    )


def test_three_models_all_approve_is_strong_consensus():
    result = classify_candidate(
        [ballot("approve"), ballot("approve"), ballot("approve")],
        expected_voter_count=3,
    )
    assert result.label == "strong_consensus"
    assert result.approve_ratio == 1


def test_approve_with_conditions_counts_as_approve():
    result = classify_candidate(
        [
            ballot("approve"),
            ballot("approve"),
            ballot("approve_with_conditions"),
        ],
        expected_voter_count=3,
    )
    assert result.label == "strong_consensus"


def test_two_of_three_with_abstain_is_qualified():
    result = classify_candidate(
        [ballot("approve"), ballot("approve"), ballot("abstain")],
        expected_voter_count=3,
    )
    assert result.label == "qualified_consensus"


def test_critical_objection_forces_disputed():
    result = classify_candidate(
        [
            ballot("approve"),
            ballot("approve"),
            ballot("object", objection_severity="critical"),
        ],
        expected_voter_count=3,
    )
    assert result.label == "disputed"
    assert result.has_critical_objection is True


def test_zero_or_one_approve_is_rejected():
    result = classify_candidate(
        [
            ballot("approve"),
            ballot("object", objection_severity="minor"),
            ballot("abstain"),
        ],
        expected_voter_count=3,
    )
    assert result.label == "rejected"


def test_five_models_all_approve_is_strong_consensus():
    result = classify_candidate(
        [ballot("approve") for _ in range(5)],
        expected_voter_count=5,
    )
    assert result.label == "strong_consensus"


def test_five_models_four_approve_is_qualified():
    result = classify_candidate(
        [
            ballot("approve"),
            ballot("approve"),
            ballot("approve"),
            ballot("approve"),
            ballot("abstain"),
        ],
        expected_voter_count=5,
    )
    assert result.label == "qualified_consensus"
    assert result.approve_ratio == pytest.approx(0.8)


def test_seven_models_major_objection_is_disputed_not_outvoted():
    result = classify_candidate(
        [
            *[ballot("approve") for _ in range(5)],
            ballot("object", objection_severity="major"),
            ballot("abstain"),
        ],
        expected_voter_count=7,
    )
    assert result.has_major_objection is True
    assert result.label == "disputed"


def test_partial_flag_when_some_models_do_not_vote():
    result = classify_candidate(
        [ballot("approve") for _ in range(4)],
        expected_voter_count=7,
    )
    assert result.partial is True
    assert result.approve_ratio == pytest.approx(4 / 7)


def test_expected_voter_count_must_be_positive():
    with pytest.raises(ValueError):
        classify_candidate([], expected_voter_count=0)


def test_object_vote_requires_severity():
    with pytest.raises(ValueError):
        ballot("object")


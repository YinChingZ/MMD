import pytest

from mmd_litellm.quorum import check_quorum, compute_quorum, meets_quorum


def test_default_ratio_for_three_models_requires_two():
    assert compute_quorum(3) == 2


def test_two_of_three_meets_quorum():
    assert meets_quorum(2, 3) is True


def test_one_of_three_does_not_meet_quorum():
    assert meets_quorum(1, 3) is False


def test_check_quorum_marks_partial_when_some_models_are_missing():
    assert check_quorum(2, 3).model_dump() == {
        "met": True,
        "required": 2,
        "respondent_count": 2,
        "partial": True,
    }


def test_check_quorum_not_partial_when_all_models_respond():
    result = check_quorum(3, 3)
    assert result.partial is False
    assert result.met is True


def test_model_count_must_be_positive():
    with pytest.raises(ValueError):
        compute_quorum(0)


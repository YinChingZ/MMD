from __future__ import annotations

import math

from pydantic import BaseModel


class QuorumCheck(BaseModel):
    met: bool
    required: int
    respondent_count: int
    partial: bool


def compute_quorum(model_count: int, ratio: float = 2 / 3) -> int:
    if model_count <= 0:
        raise ValueError("model_count must be > 0")
    return max(1, math.ceil(model_count * ratio))


def meets_quorum(
    respondent_count: int, model_count: int, ratio: float = 2 / 3
) -> bool:
    return respondent_count >= compute_quorum(model_count, ratio)


def check_quorum(
    respondent_count: int, model_count: int, ratio: float = 2 / 3
) -> QuorumCheck:
    required = compute_quorum(model_count, ratio)
    return QuorumCheck(
        met=respondent_count >= required,
        required=required,
        respondent_count=respondent_count,
        partial=respondent_count < model_count,
    )

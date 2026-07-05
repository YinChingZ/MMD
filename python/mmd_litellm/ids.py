from __future__ import annotations

from uuid import uuid4


def make_run_id() -> str:
    return f"run_{uuid4().hex[:12]}"


def scoped_id(run_id: str, local_id: str) -> str:
    if not run_id or not local_id:
        raise ValueError("run_id and local_id must be non-empty")
    if ":" in run_id:
        raise ValueError(f"run_id must not contain ':': {run_id}")
    return f"{run_id}:{local_id}"


def parse_scoped_id(value: str) -> tuple[str, str]:
    if ":" not in value:
        raise ValueError(f'invalid scoped id (expected "run_id:local_id"): {value}')
    run_id, local_id = value.split(":", 1)
    return run_id, local_id


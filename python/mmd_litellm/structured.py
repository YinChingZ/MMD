from __future__ import annotations

import json
import re
from typing import Awaitable, Callable, TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


def extract_json(text: str) -> str:
    fenced = re.search(r"```json\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fenced is None:
        fenced = re.search(r"```\s*([\s\S]*?)```", text)
    return (fenced.group(1) if fenced else text).strip()


async def call_structured(
    complete: Callable[[str | None], Awaitable[str]],
    schema: type[T],
    *,
    max_repair_attempts: int = 2,
) -> T:
    last_error: str | None = None
    for _attempt in range(max_repair_attempts + 1):
        repair_note = (
            "Your previous output failed JSON schema validation: "
            f"{last_error}. Return corrected JSON only, no prose."
            if last_error
            else None
        )
        text = await complete(repair_note)
        try:
            parsed = json.loads(extract_json(text))
            return schema.model_validate(parsed)
        except (json.JSONDecodeError, ValidationError) as error:
            last_error = str(error)

    raise ValueError(
        "structured output failed schema validation after "
        f"{max_repair_attempts + 1} attempts: {last_error}"
    )


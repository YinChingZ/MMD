from __future__ import annotations

import time
from uuid import uuid4


def openai_chat_completion_response(
    *,
    content: str,
    model: str,
    metadata: dict | None = None,
    analysis: dict | None = None,
    usage: dict | None = None,
) -> dict:
    response = {
        "id": f"chatcmpl-mmd-{uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": usage
        or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }
    if metadata:
        response["mmd"] = metadata
    if analysis:
        response["mmd_analysis"] = analysis
    return response

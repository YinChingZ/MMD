from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class UnsupportedConversationContentError(ValueError):
    """A message contains a content shape MMD does not support yet."""


class ConversationTurn(BaseModel):
    role: str
    content: str
    tool_call_id: str | None = None
    name: str | None = None
    # Untyped deliberately: malformed tool_calls must never raise a
    # ValidationError here. This is background context for panel/coordinator
    # models, not a schema MMD executes or enforces - see
    # _render_tool_calls_summary for the defensive handling.
    tool_calls: list[Any] | None = None


class ConversationContext(BaseModel):
    turns: list[ConversationTurn]
    question: str

    def rendered_context_block(self) -> str | None:
        if len(self.turns) <= 1:
            return None
        lines = []
        for turn in self.turns:
            if turn.role == "tool" and turn.tool_call_id:
                label = f"tool result ({turn.tool_call_id})"
            else:
                label = turn.role
            if turn.name:
                label = f"{label}, name={turn.name}"
            content = turn.content
            tool_calls_summary = _render_tool_calls_summary(turn.tool_calls)
            if tool_calls_summary:
                content = f"{content}; requested tool calls: {tool_calls_summary}"
            lines.append(f"[{label}] {content}")
        return "\n\n".join(lines)


def extract_conversation(messages: list[dict[str, Any]]) -> ConversationContext:
    turns: list[ConversationTurn] = []
    last_user_index: int | None = None
    for index, message in enumerate(messages):
        role = message.get("role")
        text = _extract_text(message.get("content"), index=index, role=role)
        turns.append(
            ConversationTurn(
                role=str(role or "unknown"),
                content=text,
                tool_call_id=message.get("tool_call_id"),
                name=message.get("name"),
                tool_calls=message.get("tool_calls"),
            )
        )
        if role == "user" and text:
            last_user_index = index

    if last_user_index is None:
        raise ValueError(
            "MMD provider requires at least one user message with text content"
        )

    return ConversationContext(turns=turns, question=turns[last_user_index].content)


def _extract_text(content: Any, *, index: int, role: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if not isinstance(part, dict) or part.get("type") != "text":
                part_type = part.get("type") if isinstance(part, dict) else type(part).__name__
                raise UnsupportedConversationContentError(
                    f"message[{index}] (role={role!r}) has unsupported content part "
                    f"type {part_type!r}; MMD only supports plain text content in "
                    "this version"
                )
            parts.append(str(part.get("text", "")))
        return "\n".join(part for part in parts if part)
    raise UnsupportedConversationContentError(
        f"message[{index}] (role={role!r}) has unsupported content type "
        f"{type(content).__name__}; expected a string or a list of text content parts"
    )


def _render_tool_calls_summary(tool_calls: list[Any] | None) -> str:
    """Render assistant `tool_calls` as human-readable background context.

    MMD does not execute a tool-calling loop; this exists so panel/coordinator
    models can see what tool call(s) a prior assistant turn intended, without
    MMD validating or re-serializing the `arguments` payload (kept verbatim as
    the raw JSON string per OpenAI's wire format). Malformed/partial entries
    are skipped rather than raising - this is untrusted background context,
    not a schema MMD enforces.
    """
    if not tool_calls:
        return ""
    parts: list[str] = []
    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        function = call.get("function")
        if not isinstance(function, dict):
            continue
        name = function.get("name")
        if not name:
            continue
        arguments = function.get("arguments", "")
        parts.append(f"{name}({arguments})")
    return ", ".join(parts)

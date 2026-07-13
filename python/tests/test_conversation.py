import pytest

from mmd_litellm.conversation import (
    UnsupportedConversationContentError,
    extract_conversation,
)


def test_extract_conversation_requires_user_message():
    with pytest.raises(ValueError) as excinfo:
        extract_conversation([{"role": "assistant", "content": "No user prompt."}])
    assert str(excinfo.value) == (
        "MMD provider requires at least one user message with text content"
    )


def test_extract_conversation_requires_user_message_when_empty():
    with pytest.raises(ValueError):
        extract_conversation([])


def test_extract_conversation_joins_text_parts_of_last_user_message():
    conversation = extract_conversation(
        [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "First part."},
                    {"type": "text", "text": "Second part."},
                ],
            }
        ]
    )
    assert conversation.question == "First part.\nSecond part."


def test_extract_conversation_uses_last_user_message_among_several():
    conversation = extract_conversation(
        [
            {"role": "user", "content": "First question"},
            {"role": "assistant", "content": "An answer"},
            {"role": "user", "content": "Second question"},
        ]
    )
    assert conversation.question == "Second question"


def test_extract_conversation_rejects_image_url_content_part():
    with pytest.raises(UnsupportedConversationContentError) as excinfo:
        extract_conversation(
            [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": "http://x"}}
                    ],
                }
            ]
        )
    assert "image_url" in str(excinfo.value)


def test_extract_conversation_rejects_content_part_without_type():
    with pytest.raises(UnsupportedConversationContentError):
        extract_conversation(
            [{"role": "user", "content": [{"text": "no type key here"}]}]
        )


def test_extract_conversation_rejects_non_string_non_list_content():
    with pytest.raises(UnsupportedConversationContentError):
        extract_conversation([{"role": "user", "content": 42}])


def test_extract_conversation_returns_none_context_for_single_user_message():
    conversation = extract_conversation(
        [{"role": "user", "content": "Only one message"}]
    )
    assert conversation.rendered_context_block() is None


def test_extract_conversation_renders_system_history_and_tool_results():
    conversation = extract_conversation(
        [
            {"role": "system", "content": "Be concise."},
            {"role": "user", "content": "What should we build next?"},
            {"role": "assistant", "content": "Let me check a tool."},
            {
                "role": "tool",
                "tool_call_id": "call_1",
                "content": "search results: monorepo pros/cons",
            },
            {"role": "user", "content": "Given that, what do you recommend?"},
        ]
    )
    assert conversation.question == "Given that, what do you recommend?"
    context = conversation.rendered_context_block()
    assert context is not None
    assert "Be concise." in context
    assert "What should we build next?" in context
    assert "Let me check a tool." in context
    assert "search results: monorepo pros/cons" in context
    assert "call_1" in context


def test_extract_conversation_treats_toolcall_only_assistant_message_as_empty_turn():
    # Deliberately has no "tool_calls" key at all (distinct from the populated-
    # tool_calls tests below) - this is the "no content, no tool_calls" case.
    conversation = extract_conversation(
        [
            {"role": "user", "content": "Search for X."},
            {"role": "assistant", "content": None},
            {"role": "user", "content": "Now summarize."},
        ]
    )
    assert conversation.question == "Now summarize."
    assert conversation.rendered_context_block() is not None


def test_extract_conversation_renders_developer_role_in_context():
    conversation = extract_conversation(
        [
            {"role": "developer", "content": "Follow the internal style guide."},
            {"role": "user", "content": "What should we build next?"},
        ]
    )
    context = conversation.rendered_context_block()
    assert context is not None
    assert "[developer] Follow the internal style guide." in context


def test_extract_conversation_renders_name_field_when_present():
    conversation = extract_conversation(
        [
            {"role": "user", "content": "What tool should I call?", "name": "alice"},
            {"role": "assistant", "content": "Use search."},
        ]
    )
    context = conversation.rendered_context_block()
    assert context is not None
    assert "user, name=alice" in context


def test_extract_conversation_renders_tool_calls_on_assistant_message():
    conversation = extract_conversation(
        [
            {"role": "user", "content": "Search for X."},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "web_search",
                            "arguments": '{"query": "X"}',
                        },
                    }
                ],
            },
            {"role": "user", "content": "Now summarize."},
        ]
    )
    context = conversation.rendered_context_block()
    assert context is not None
    assert 'requested tool calls: web_search({"query": "X"})' in context


def test_extract_conversation_skips_malformed_tool_call_entries_without_raising():
    conversation = extract_conversation(
        [
            {"role": "user", "content": "Search for X."},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {"id": "call_1"},  # missing "function"
                    "not-a-dict",
                    {"id": "call_2", "function": {"arguments": "{}"}},  # missing "name"
                ],
            },
            {"role": "user", "content": "Now summarize."},
        ]
    )
    context = conversation.rendered_context_block()
    assert context is not None
    assert "requested tool calls" not in context

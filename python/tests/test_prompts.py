from mmd_litellm.prompts import (
    build_direct_answer_prompt,
    build_outline_prompt,
    build_propose_prompt,
)


def test_build_propose_prompt_includes_conversation_context_when_provided():
    request = build_propose_prompt(
        question="What should we build next?",
        model_id="model_a",
        conversation_context="[system] Be concise.\n\n[user] Earlier turn.",
    )
    assert "Conversation context so far:" in request.user_prompt
    assert "[system] Be concise." in request.user_prompt
    assert "Question: What should we build next?" in request.user_prompt


def test_build_propose_prompt_omits_conversation_block_when_absent():
    request = build_propose_prompt(question="What should we build next?", model_id="model_a")
    assert "Conversation context so far:" not in request.user_prompt
    assert request.user_prompt.startswith("Question:")


def test_build_outline_prompt_includes_conversation_context_when_provided():
    request = build_outline_prompt(
        question="Plan our monorepo migration.",
        conversation_context="[user] We use three repos today.",
    )
    assert "Conversation context so far:" in request.user_prompt
    assert "[user] We use three repos today." in request.user_prompt


def test_build_outline_prompt_omits_conversation_block_when_absent():
    request = build_outline_prompt(question="Plan our monorepo migration.")
    assert "Conversation context so far:" not in request.user_prompt
    assert request.user_prompt == "Question: Plan our monorepo migration."


def test_build_direct_answer_prompt_includes_conversation_context_when_provided():
    request = build_direct_answer_prompt(
        question="What should we build next?",
        conversation_context="[user] Earlier turn.",
    )
    assert "Conversation context so far:" in request.user_prompt
    assert "[user] Earlier turn." in request.user_prompt
    assert "Question: What should we build next?" in request.user_prompt
    assert request.meta["phase"] == "direct_answer"


def test_build_direct_answer_prompt_omits_conversation_block_when_absent():
    request = build_direct_answer_prompt(question="What should we build next?")
    assert "Conversation context so far:" not in request.user_prompt
    assert request.user_prompt == "Question: What should we build next?"
    assert "Return ONLY JSON" not in request.system_prompt

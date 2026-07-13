from mmd_litellm.policy import decide_auto_deliberation, resolve_deliberation_policy


def test_decide_auto_deliberation_skips_short_factual_question():
    decision = decide_auto_deliberation("What is the capital of France?")
    assert decision.deliberate is False
    assert decision.signals["is_long"] is False
    assert decision.signals["matched_markers"] == []


def test_decide_auto_deliberation_runs_for_long_question():
    question = (
        "We are a ten person team maintaining three separate internal services "
        "written in different languages and want to know how to restructure our "
        "codebase for the next two years of growth."
    )
    decision = decide_auto_deliberation(question)
    assert decision.deliberate is True
    assert decision.signals["is_long"] is True


def test_decide_auto_deliberation_runs_for_decision_language_even_if_short():
    decision = decide_auto_deliberation("Should we adopt microservices?")
    assert decision.deliberate is True
    assert decision.signals["is_long"] is False
    assert "should we" in decision.signals["matched_markers"]


def test_decide_auto_deliberation_conversation_context_does_not_force_deliberation():
    decision = decide_auto_deliberation(
        "What is the capital of France?",
        conversation_context="user: hi\nassistant: hello, how can I help?",
    )
    assert decision.deliberate is False


def test_resolve_deliberation_policy_off_is_static():
    result = resolve_deliberation_policy(
        "off", "Should we adopt microservices? This is a long complex question " * 3
    )
    assert result.policy == "off"
    assert result.deliberated is False


def test_resolve_deliberation_policy_required_is_static():
    result = resolve_deliberation_policy("required", "What is the capital of France?")
    assert result.policy == "required"
    assert result.deliberated is True


def test_resolve_deliberation_policy_auto_delegates_to_heuristic():
    short_result = resolve_deliberation_policy(
        "auto", "What is the capital of France?"
    )
    assert short_result.policy == "auto"
    assert short_result.deliberated is False
    assert short_result.auto_signals is not None

    decision_result = resolve_deliberation_policy(
        "auto", "Should we adopt microservices?"
    )
    assert decision_result.deliberated is True

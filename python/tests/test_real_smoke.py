import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "proxy_real_smoke.py"
SPEC = importlib.util.spec_from_file_location("proxy_real_smoke", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
proxy_real_smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proxy_real_smoke)


def test_real_smoke_config_includes_optional_run_limits():
    config = proxy_real_smoke._config_yaml(
        model_name="mmd-fusion-real",
        analysis_models=["openrouter/openai/gpt-4o-mini"],
        coordinator_model="openrouter/openai/gpt-4o-mini",
        preset=None,
        mode="quick",
        quorum_ratio=1.0,
        per_model_timeout=30.0,
        max_run_timeout=90.0,
        max_total_calls=4,
        max_repair_attempts=1,
        max_topics=3,
        max_completion_tokens=512,
        temperature=0.2,
        coordinator_temperature=0.1,
    )

    assert "      max_run_timeout: 90.0" in config
    assert "      max_total_calls: 4" in config


def test_real_smoke_config_omits_unset_run_limits():
    config = proxy_real_smoke._config_yaml(
        model_name="mmd-fusion-real",
        analysis_models=["openrouter/openai/gpt-4o-mini"],
        coordinator_model="openrouter/openai/gpt-4o-mini",
        preset=None,
        mode="quick",
        quorum_ratio=1.0,
        per_model_timeout=None,
        max_run_timeout=None,
        max_total_calls=None,
        max_repair_attempts=1,
        max_topics=3,
        max_completion_tokens=None,
        temperature=None,
        coordinator_temperature=None,
    )

    assert "max_run_timeout" not in config
    assert "max_total_calls" not in config


def test_real_smoke_parses_and_asserts_partial_quorum(monkeypatch):
    monkeypatch.setenv("MMD_SMOKE_EXPECT_PARTIAL", "true")
    assert proxy_real_smoke._optional_bool_env("MMD_SMOKE_EXPECT_PARTIAL") is True
    proxy_real_smoke._assert_expected_partial(
        {"quorum": [{"phase": "propose", "partial": True}]}, True
    )


def test_real_smoke_rejects_invalid_partial_expectation(monkeypatch):
    monkeypatch.setenv("MMD_SMOKE_EXPECT_PARTIAL", "maybe")
    try:
        proxy_real_smoke._optional_bool_env("MMD_SMOKE_EXPECT_PARTIAL")
    except ValueError as error:
        assert "must be true or false" in str(error)
    else:
        raise AssertionError("invalid boolean must be rejected")

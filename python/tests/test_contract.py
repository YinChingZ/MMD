"""Schema/contract stability tests for the MMD trace/analysis response envelopes.

These tests exist to catch accidental breaking changes to the `mmd` (trace) and
`mmd_analysis` response contracts - a field rename or removal here should fail a
test, not silently pass. When the shape intentionally changes, update this test
and the versioning note in docs/architecture.md in the same change.
"""
import asyncio

from mmd_litellm.litellm_provider import MMDLiteLLMProvider
from tests.test_orchestrator import ScriptedClient

TRACE_KEYS = {
    "trace_version",
    "protocol_version",
    "run_id",
    "mode",
    "governance",
    "status",
    "versions",
    "artifacts",
    "candidate_sets",
    "calls",
    "quorum",
    "failures",
    "usage",
    "extensions",
}

ANALYSIS_KEYS = {
    "analysis_version",
    "protocol",
    "run_id",
    "mode",
    "consensus_summary",
    "disagreements",
    "model_coverage",
    "notable_unique_points",
    "performance",
    "limitations",
}


def test_trace_and_analysis_payload_key_sets_are_stable_for_quick_mode():
    provider = MMDLiteLLMProvider(client=ScriptedClient())
    response = asyncio.run(
        provider.acompletion(
            model="mmd/fusion",
            messages=[{"role": "user", "content": "What should we build next?"}],
            optional_params={
                "analysis_models": ["model_a", "model_b"],
                "return_trace": True,
                "return_analysis": True,
            },
        )
    )

    assert set(response["mmd"].keys()) == TRACE_KEYS
    assert set(response["mmd_analysis"].keys()) == ANALYSIS_KEYS

# MMD LiteLLM PoC

This package is the Python/LiteLLM-shaped proof of concept for the M2' branch.
It keeps the current TypeScript implementation as the behavior reference while
porting the protocol core into Python/Pydantic.

## Run tests

```bash
uv run --project python --extra test pytest
```

## LiteLLM custom provider

The provider is exposed as `mmd/fusion` through LiteLLM's custom provider hook:

```yaml
model_list:
  - model_name: mmd-fusion
    litellm_params:
      model: mmd/fusion
      analysis_models:
        - openai/gpt-4.1-mini
        - anthropic/claude-3-5-haiku
      coordinator_model: openai/gpt-4.1-mini
      preset: balanced
      mmd_mode: quick
      max_completion_tokens: 1200
      temperature: 0.4
      coordinator_temperature: 0.1
      return_trace: false

litellm_settings:
  custom_provider_map:
    - provider: mmd
      custom_handler: mmd_handler.mmd_custom_llm
```

The PoC currently implements quick, standard, and planning modes:

```text
quick:    Propose -> Normalize -> Compose
standard: Propose -> Critique -> Revise -> Normalize -> Vote -> Compose
planning: Outline -> per-topic standard deliberation -> Section Compose
```

Planning returns the full plan document as normal assistant content, while
`return_trace=true` exposes the outline, per-topic traces, failed topics,
`plan_document`, and per-call usage events in top-level `mmd` metadata.

When `return_trace=true`, the Proxy response includes top-level provider-specific
`mmd` metadata with `trace_version: 1` and `protocol: "mmd.v1"`. The default
`return_trace=false` path keeps the normal OpenAI-compatible answer content
unchanged. The standard OpenAI-compatible `usage` field is populated from
aggregated panel/coordinator calls when underlying provider responses include
token usage.

Set `mmd_log_trace=true` to send a slimmer audit payload to a configured
CustomLogger-style trace logger without returning the full trace in the HTTP
response. The callback payload includes the run id, mode, quorum, candidate
claims, classifications, failures, and usage summary.

Set `return_analysis=true` to return a lightweight top-level `mmd_analysis`
payload for application consumption. It includes consensus summary,
disagreements, model coverage, notable unique points, limitations, and does not
require an extra model call.

Advanced config is supported for LiteLLM/Fusion parity. `preset=cheap`,
`balanced`, or `strong` caps the configured panel to 2, 3, or 5 models and sets
per-model timeout defaults of 30, 60, or 120 seconds; it does not expand hardcoded
vendor models. `max_analysis_models`, `max_completion_tokens`, panel
`temperature`, low default `coordinator_temperature`, `reasoning`,
`model_params`, `analysis_model_params`, and `coordinator_model_params` are
forwarded to the underlying LiteLLM calls.

Provider-facing errors are typed without requiring the LiteLLM runtime extra:
invalid request/config errors raise `MMDProviderBadRequestError` with status 400,
quorum failures raise `MMDProviderQuorumError` with quorum details, and runtime
failures raise `MMDProviderAPIError` with status 500.

Provider-managed tools are supported as a passthrough. `tools`, `tool_choice`,
and `max_tool_calls` are forwarded to panel phases by default; set
`coordinator_tools_enabled=true` to also forward them to outline/normalize/compose
coordinator phases. Trace and logging payloads include a `tooling` summary with
availability and limits only; MMD does not yet execute a local function-calling
tool loop.

## Proxy smoke test

The LiteLLM Proxy loads `custom_handler` modules relative to the config file, so
the examples directory includes tiny handler shims. Run the local HTTP smoke
test with a deterministic scripted panel:

```bash
uv run --project python --extra proxy python python/scripts/proxy_smoke.py
```

The smoke test asserts the HTTP response includes `mmd.trace_version == 1`.

## Real-model Proxy smoke

Use the real-model smoke harness when provider keys are available in your
environment. It writes a temporary LiteLLM config, starts a local Proxy, calls
`/chat/completions`, and asserts that the response keeps the trace contract.

```bash
export OPENROUTER_API_KEY=...
export MMD_SMOKE_ANALYSIS_MODELS="openrouter/openai/gpt-4o-mini,openrouter/google/gemini-flash-1.5"
export MMD_SMOKE_COORDINATOR_MODEL="openrouter/openai/gpt-4o-mini"

uv run --project python --extra proxy python python/scripts/proxy_real_smoke.py
```

Optional knobs: `MMD_SMOKE_MODE` (`quick`, `standard`, or `planning`; default
`quick`), `MMD_SMOKE_QUESTION`, `MMD_SMOKE_PER_MODEL_TIMEOUT`,
`MMD_SMOKE_HTTP_TIMEOUT`, `MMD_SMOKE_MAX_TOPICS`, `MMD_SMOKE_QUORUM_RATIO`,
`MMD_SMOKE_MAX_REPAIR_ATTEMPTS`, `MMD_SMOKE_PRESET`,
`MMD_SMOKE_MAX_COMPLETION_TOKENS`, `MMD_SMOKE_TEMPERATURE`, and
`MMD_SMOKE_COORDINATOR_TEMPERATURE`. If `MMD_SMOKE_ANALYSIS_MODELS` is not set,
the script exits successfully with a `skipped` JSON payload.

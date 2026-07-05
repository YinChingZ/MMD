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
      mmd_mode: standard
      return_trace: false

litellm_settings:
  custom_provider_map:
    - provider: mmd
      custom_handler: mmd_handler.mmd_custom_llm
```

The PoC currently implements quick and standard modes:

```text
quick:    Propose -> Normalize -> Compose
standard: Propose -> Critique -> Revise -> Normalize -> Vote -> Compose
```

Planning orchestration is intentionally left for the next milestone after the
provider shape and standard protocol port are stable.

## Proxy smoke test

The LiteLLM Proxy loads `custom_handler` modules relative to the config file, so
the examples directory includes tiny handler shims. Run the local HTTP smoke
test with a deterministic scripted panel:

```bash
uv run --project python --extra proxy python python/scripts/proxy_smoke.py
```

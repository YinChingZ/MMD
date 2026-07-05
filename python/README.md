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
      mmd_mode: quick
      return_trace: false

litellm_settings:
  custom_provider_map:
    - provider: mmd
      custom_handler: mmd_litellm.custom_handler.mmd_custom_llm
```

The first PoC implements quick mode:

```text
Propose -> Normalize -> Compose
```

Full standard/planning orchestration is intentionally left for the next
milestone after the provider shape and Python protocol port are stable.


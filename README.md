# MMD LiteLLM integration

This branch is the Python staging area for contributing MMD upstream to
LiteLLM. It intentionally contains no standalone TypeScript CLI or npm
workspace. The TypeScript product remains on `main`; cross-language parity is
defined by `contract/mmd-protocol-v3/`, not by copying either implementation.

MMD is a multi-call meta-provider that exposes a virtual `mmd/fusion` model and
delegates every underlying completion to LiteLLM Router/`acompletion`.

## Repository layout

```text
contract/mmd-protocol-v3/  language-neutral schema and golden vectors
python/mmd_litellm/        protocol core plus the thin LiteLLM adapter
python/tests/               mocked unit, parity, provider, and Proxy tests
python/examples/            LiteLLM Proxy configuration and handler shim
docs/upstream-rfc.md        maintainer-facing design proposal
```

## Development

```bash
uv run --project python --extra test pytest
uv run --project python --extra proxy python python/scripts/proxy_smoke.py
```

All unit tests mock external model calls. Real-provider checks are opt-in and
must read credentials only from the environment.

See [architecture](docs/architecture.md), [development and migration](docs/development.md),
and the [upstream RFC](docs/upstream-rfc.md).

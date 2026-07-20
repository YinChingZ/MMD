# Development and upstream migration

## Local gates

```bash
uv run --project python --extra test pytest
uv run --project python --with build python -m build python
```

The parity suite reads `contract/mmd-protocol-v3/fixtures/parity-golden.json`
and `scenario-matrix.json`. Fixtures fix run IDs, clocks, algorithm inputs,
phase/failure expectations, and mock usage; only timestamps and real latency
may be normalized during comparison.

## Branch policy

- This branch contains only the Python/LiteLLM staging implementation.
- The TypeScript product remains on `main`.
- Branches share schema and fixtures, never implementation copies or a full
  branch merge.
- Git history is the archive for removed npm/TypeScript code; no `legacy/`
  duplicate is maintained.

## Upstream sequence

1. Open the design RFC and obtain maintainer direction on a virtual provider
   versus a Router/strategy extension point.
2. PR 1: protocol types, deterministic algorithms, trace serializer, mocked
   golden fixtures.
3. PR 2: asynchronous Quick and Standard-C orchestration with Router.
4. PR 3: Proxy/provider registration, streaming, exceptions, and usage/cost.
5. PR 4: experimental Standard-D behind a versioned alignment policy.
6. PR 5: Planning with one GlobalCompose.

Each PR must be independently reviewable, avoid real network calls in unit
tests, and run the LiteLLM OSS branch's current `make lint` and
`make test-unit` gates. Documentation follows LiteLLM's separate documentation
repository workflow.

## Explicitly deferred

- The local `web_fetch` loop is not part of the initial upstream series.
- Real-provider quality benchmarking and long-term outcome statistics are
  independent follow-ups and do not block protocol v3.
- No built-in placement is assumed until maintainers answer the RFC.

# MMD Protocol v3 contract

This directory is the language-neutral compatibility boundary between the
TypeScript product implementation and the Python LiteLLM integration.

- JSON on the wire uses `snake_case`.
- Hosts, never models, assign authoritative artifact, candidate-set, candidate,
  call, and output-span identifiers.
- `mmd.trace.v3` records immutable artifacts as they complete. A later phase
  failure does not erase earlier artifacts.
- Timing fields may differ between implementations. Protocol fields, IDs,
  ballots, classifications, lineage, failures, and usage totals may not.
- Quick is centralized and uses exactly two distinct models. Planning v3 is
  centralized and performs one `global_compose` after topic deliberation.
- Distributed Standard remains experimental and requires a versioned alignment
  policy in an experiment manifest.

`fixtures/parity-golden.json` contains deterministic vectors that both
implementations must execute. It is intentionally model-free.
`fixtures/scenario-matrix.json` freezes the run ID, clock, mock usage, required
phase sequences, degradation cases, and terminal expectations for the shared
Quick, Standard-C/D, and Planning parity suite.

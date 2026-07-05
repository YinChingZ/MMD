-- M5.1 follow-up: lets a BYOK user persist a custom $/1M-token rate
-- alongside a saved key, so it's applied automatically on reuse instead of
-- silently reverting to the built-in approximate table (or "unknown" for a
-- provider we don't recognize at all). Nullable — most saved keys won't set
-- this, and fall back to @mmd/protocol's calculateCostUsd as before.

-- double precision, not numeric: node-postgres returns `numeric` columns as
-- strings (to avoid float precision loss on arbitrary-precision decimals),
-- which would silently violate this repo's `number | null` TS type unless
-- every read parsed it back. These are approximate $/1M-token rates, not
-- money amounts needing exact decimal arithmetic, so plain floats are fine.
alter table workspace_api_keys
  add column input_per_million double precision,
  add column output_per_million double precision;

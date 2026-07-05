-- M5.5: opt-in public share links. Nullable and only ever set once a
-- visitor clicks "Share" on a completed run (see routes/runs.ts) — most
-- runs never get one. The partial index only covers rows that actually
-- have a token, since lookups always filter on share_token is not null
-- implicitly (a null token never matches a real request path).
alter table runs add column share_token text unique;
create index runs_share_token_idx on runs (share_token) where share_token is not null;

-- BYOK M4 step 4: optional persisted API keys. provider_id is validated
-- against packages/protocol's PROVIDER_WHITELIST at write time (not FK-
-- enforced — the whitelist lives in code, not the DB). encrypted_key is
-- AES-256-GCM ciphertext (iv || ciphertext || authTag), see
-- src/crypto/key-encryption.ts. Plaintext keys are never stored.

create table workspace_api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  provider_id text not null,
  model_id text not null,
  label text,
  encrypted_key bytea not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider_id, model_id)
);

create index workspace_api_keys_workspace_id_idx on workspace_api_keys (workspace_id);

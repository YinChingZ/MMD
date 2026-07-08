-- BYOK M4 step 3: anonymous workspace/session scoping. No login — every
-- visitor gets an opaque workspace token (cookie) so GET /api/conversations
-- and friends don't leak one visitor's history to another the moment more
-- than one person uses a deployed instance. See docs/roadmap.md
-- and docs/protocol.md for the full BYOK design rationale.

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Nullable: rows created before this migration (or via any path that somehow
-- skips workspace resolution) stay unowned rather than becoming an FK error.
-- Pre-existing conversations/runs are treated as archived — no workspace
-- can see them (this is a pre-launch codebase with no real user data yet).
alter table conversations add column workspace_id uuid references workspaces(id);
alter table runs add column workspace_id uuid references workspaces(id);

create index conversations_workspace_id_idx on conversations (workspace_id);
create index runs_workspace_id_idx on runs (workspace_id);

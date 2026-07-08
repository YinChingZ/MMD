-- M2 initial schema. See docs/protocol.md and the M0 risk table in
-- docs/roadmap.md for why run-scoped composite keys
-- are used instead of the original tech design doc's bare `id text primary key`.

create table conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table runs (
  id text primary key, -- @mmd/protocol makeRunId(), e.g. "run_8f2a1c3d9e01"
  conversation_id uuid not null references conversations(id),
  question text not null,
  mode text not null, -- standard | quick | planning
  protocol_version text not null default 'v0.1',
  status text not null, -- running | completed | failed
  model_config jsonb not null,
  budget jsonb not null,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index runs_conversation_id_idx on runs (conversation_id);

create table run_events (
  id bigserial primary key,
  run_id text not null references runs(id),
  seq integer not null, -- per-run monotonic sequence; sent to clients as SSE `id:` for Last-Event-ID resume
  type text not null,
  phase text,
  topic_id text,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

create index run_events_run_id_seq_idx on run_events (run_id, seq);

create table claims (
  run_id text not null references runs(id),
  claim_id text not null,
  model_id text not null,
  topic_id text,
  text text not null,
  claim_type text not null,
  confidence numeric,
  rationale text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, claim_id)
);

create table reviews (
  id bigserial primary key,
  run_id text not null references runs(id),
  reviewer_model_id text not null,
  target_claim_id text not null,
  topic_id text,
  stance text not null,
  severity text not null,
  comment text not null,
  suggested_revision text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index reviews_run_id_target_claim_idx on reviews (run_id, target_claim_id);

create table candidates (
  run_id text not null references runs(id),
  candidate_id text not null,
  topic_id text,
  text text not null,
  source_claim_ids text[] not null,
  notes text,
  classification jsonb not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, candidate_id)
);

create table votes (
  run_id text not null references runs(id),
  candidate_id text not null,
  model_id text not null,
  vote text not null,
  confidence numeric,
  reason text,
  objection_severity text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, candidate_id, model_id)
);

-- Full DeliberationResult snapshot, keyed by run — the source of truth for
-- GET /api/runs/:id/result. claims/reviews/candidates/votes above are a
-- queryable projection of the same data for future per-claim UI features,
-- not the primary read path.
create table run_results (
  run_id text primary key references runs(id),
  proposals jsonb not null,
  critiques jsonb not null,
  revisions jsonb not null,
  normalize jsonb not null,
  votes jsonb not null,
  classifications jsonb not null,
  final_answer jsonb,
  outline jsonb,
  topics jsonb,
  plan_document jsonb,
  timings jsonb not null,
  quorum jsonb not null,
  created_at timestamptz not null default now()
);

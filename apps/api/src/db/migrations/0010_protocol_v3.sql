alter table runs
  alter column protocol_version set default 'mmd.v3';

alter table runs
  add column governance text not null default 'centralized';

alter table run_results
  add column trace jsonb;

alter table run_results
  add column planning_final jsonb;

create table run_traces (
  run_id text primary key references runs(id) on delete cascade,
  status text not null,
  trace jsonb not null,
  updated_at timestamptz not null default now()
);

create table run_artifacts (
  run_id text not null references runs(id) on delete cascade,
  artifact_id text not null,
  kind text not null,
  phase text not null,
  status text not null,
  topic_id text,
  candidate_set_id text,
  parent_ids jsonb not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, artifact_id)
);

create index run_artifacts_run_phase_idx on run_artifacts(run_id, phase);
create index run_artifacts_run_topic_idx on run_artifacts(run_id, topic_id);

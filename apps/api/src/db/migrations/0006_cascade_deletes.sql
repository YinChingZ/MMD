-- M5.3: rate limiting & data cleanup. None of the existing FKs cascade on
-- delete, so a manual DELETE /api/conversations/:id or the stale-workspace
-- cleanup script would otherwise fail on the first dependent row instead of
-- cleaning up. Redoing each FK with ON DELETE CASCADE (rather than deleting
-- child rows in application code, dependency-order by hand) means the DB
-- itself guarantees nothing gets left orphaned.

alter table conversations drop constraint conversations_workspace_id_fkey;
alter table conversations add constraint conversations_workspace_id_fkey
  foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table runs drop constraint runs_workspace_id_fkey;
alter table runs add constraint runs_workspace_id_fkey
  foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table runs drop constraint runs_conversation_id_fkey;
alter table runs add constraint runs_conversation_id_fkey
  foreign key (conversation_id) references conversations(id) on delete cascade;

alter table workspace_api_keys drop constraint workspace_api_keys_workspace_id_fkey;
alter table workspace_api_keys add constraint workspace_api_keys_workspace_id_fkey
  foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table run_events drop constraint run_events_run_id_fkey;
alter table run_events add constraint run_events_run_id_fkey
  foreign key (run_id) references runs(id) on delete cascade;

alter table claims drop constraint claims_run_id_fkey;
alter table claims add constraint claims_run_id_fkey
  foreign key (run_id) references runs(id) on delete cascade;

alter table reviews drop constraint reviews_run_id_fkey;
alter table reviews add constraint reviews_run_id_fkey
  foreign key (run_id) references runs(id) on delete cascade;

alter table candidates drop constraint candidates_run_id_fkey;
alter table candidates add constraint candidates_run_id_fkey
  foreign key (run_id) references runs(id) on delete cascade;

alter table votes drop constraint votes_run_id_fkey;
alter table votes add constraint votes_run_id_fkey
  foreign key (run_id) references runs(id) on delete cascade;

alter table run_results drop constraint run_results_run_id_fkey;
alter table run_results add constraint run_results_run_id_fkey
  foreign key (run_id) references runs(id) on delete cascade;

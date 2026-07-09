-- M6.5: validated inline image inputs are retained with their run so the
-- original propose call can be audited during the workspace retention window.
-- They are deliberately not projected into GET /run, GET /result, SSE, or
-- public share responses. Deleting a workspace already cascades to runs.
alter table runs add column input_images jsonb not null default '[]'::jsonb;

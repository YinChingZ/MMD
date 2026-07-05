-- M5.1 cost circuit breaker: surface the accumulated run cost via
-- GET /api/runs/:id/result. Nullable since existing rows predate this
-- column and were never cost-tracked.
alter table run_results add column cost jsonb;

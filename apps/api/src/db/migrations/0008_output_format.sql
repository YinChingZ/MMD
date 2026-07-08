-- M6.1 user-defined JSON output: echoes the caller's requested format, the
-- reformatted result once validated against it, and a degrade-not-crash
-- error message if repair retries were exhausted. All nullable — existing
-- rows predate this feature and were never asked for a custom format.
alter table run_results add column output_format jsonb;
alter table run_results add column user_output jsonb;
alter table run_results add column user_output_error text;

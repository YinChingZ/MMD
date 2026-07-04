import { Kysely, sql } from "kysely";
import { Pool } from "pg";
import { createDb, type Database } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";

/**
 * Integration tests in this directory hit a real Postgres — consistent with
 * this project's already-learned lesson that mocks miss real bugs (see
 * multi-model-deliberation-dev-roadmap.md's "mock 太听话导致测试有盲区" note).
 * They're gated on DATABASE_URL and skipped (not faked) when it's absent —
 * `docker compose up -d postgres` + `.env`'s DATABASE_URL sets this up.
 */
export function hasTestDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function setupTestDb(): Promise<Kysely<Database>> {
  const databaseUrl = process.env.DATABASE_URL as string;
  const pool = new Pool({ connectionString: databaseUrl });
  await runMigrations(pool);
  await pool.end();
  return createDb(databaseUrl);
}

export async function truncateAll(db: Kysely<Database>): Promise<void> {
  await sql`truncate table run_results, votes, candidates, reviews, claims, run_events, runs, conversations restart identity cascade`.execute(
    db
  );
}

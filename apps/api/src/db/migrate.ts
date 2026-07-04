import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { loadApiEnv, loadEnvFile } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

/**
 * Hand-rolled migration runner: applies migrations/*.sql (in filename order)
 * not yet recorded in `_migrations`, each inside its own transaction. No
 * migration framework — the handful of tables in M2 don't warrant Prisma's/
 * Drizzle's codegen machinery.
 */
export async function runMigrations(pool: Pool): Promise<string[]> {
  await pool.query(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const { rows } = await pool.query<{ name: string }>(
    "select name from _migrations"
  );
  const applied = new Set(rows.map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into _migrations (name) values ($1)", [file]);
      await client.query("commit");
      newlyApplied.push(file);
    } catch (err) {
      await client.query("rollback");
      throw new Error(
        `migration ${file} failed: ${(err as Error).message}`
      );
    } finally {
      client.release();
    }
  }
  return newlyApplied;
}

async function main(): Promise<void> {
  loadEnvFile(".env");
  loadEnvFile(".env.local");
  const { databaseUrl } = loadApiEnv();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const applied = await runMigrations(pool);
    console.log(
      applied.length ? `Applied: ${applied.join(", ")}` : "No new migrations."
    );
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

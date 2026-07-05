import { loadApiEnv, loadEnvFile } from "../config/env.js";
import { createDb } from "./client.js";
import { deleteStaleWorkspaces } from "../repositories/workspaces-repo.js";

// M5.3: anonymous workspaces (see middleware/workspace.ts) otherwise
// accumulate forever — nothing else ever deletes one. Meant to run on a
// schedule (cron/systemd timer), not on the request path. 30 days is the
// project's chosen default; override with WORKSPACE_CLEANUP_DAYS for a
// one-off run with a different window.
const DEFAULT_CLEANUP_DAYS = 30;

async function main(): Promise<void> {
  loadEnvFile(".env");
  loadEnvFile(".env.local");
  const { databaseUrl } = loadApiEnv();
  const days = Number(
    process.env.WORKSPACE_CLEANUP_DAYS ?? DEFAULT_CLEANUP_DAYS
  );
  const db = createDb(databaseUrl);
  try {
    const deletedIds = await deleteStaleWorkspaces(db, days);
    console.log(
      deletedIds.length
        ? `Deleted ${deletedIds.length} workspace(s) inactive for over ${days} day(s): ${deletedIds.join(", ")}`
        : `No workspaces inactive for over ${days} day(s).`
    );
  } finally {
    await db.destroy();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

import type { Kysely } from "kysely";
import type { Database } from "../db/client.js";
import { appendRunEvent } from "../repositories/events-repo.js";
import { markRunFailed } from "../repositories/runs-repo.js";

export const RESTART_INTERRUPTED_MESSAGE =
  "Interrupted by a server restart before completion.";

/**
 * Runs once at process startup, before the server accepts requests. A `runs`
 * row still `status = "running"` at this point can only be left over from a
 * previous process instance — this process hasn't started any runs of its
 * own yet — so whatever background `runDeliberation` promise was driving it
 * died with the old process and will never emit another event. Left alone,
 * a client that reconnects sees the run stuck "running" forever (GET
 * /events replays the persisted backlog, then — since status is still
 * "running" — keeps the connection open waiting for events that will never
 * arrive). Marking it failed with a real persisted run_failed event gives
 * reconnecting clients an actual terminal state instead of an indefinite
 * hang, at the cost of losing whatever partial progress that run had made
 * (no cross-restart resumability — not needed yet at this project's scale,
 * see multi-model-deliberation-dev-roadmap.md).
 */
export async function reconcileOrphanedRuns(
  db: Kysely<Database>
): Promise<number> {
  const orphaned = await db
    .selectFrom("runs")
    .select("id")
    .where("status", "=", "running")
    .execute();

  for (const { id: runId } of orphaned) {
    const last = await db
      .selectFrom("run_events")
      .select("seq")
      .where("run_id", "=", runId)
      .orderBy("seq", "desc")
      .limit(1)
      .executeTakeFirst();

    await appendRunEvent(db, {
      runId,
      seq: (last?.seq ?? 0) + 1,
      event: {
        type: "run_failed",
        runId,
        timestamp: new Date().toISOString(),
        data: {
          reason: "server_restart",
          message: RESTART_INTERRUPTED_MESSAGE,
        },
      },
    });
    await markRunFailed(db, runId, RESTART_INTERRUPTED_MESSAGE);
  }

  return orphaned.length;
}

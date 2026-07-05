import { getBudget } from "@mmd/protocol";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/client.js";
import { appendRunEvent, listRunEventsSince } from "../src/repositories/events-repo.js";
import { createConversation } from "../src/repositories/conversations-repo.js";
import { createRun, getRun } from "../src/repositories/runs-repo.js";
import { createWorkspace } from "../src/repositories/workspaces-repo.js";
import {
  RESTART_INTERRUPTED_MESSAGE,
  reconcileOrphanedRuns,
} from "../src/services/reconcile-runs.js";
import { hasTestDatabase, setupTestDb, truncateAll } from "./db-helpers.js";

const describeIfDb = hasTestDatabase() ? describe : describe.skip;
if (!hasTestDatabase()) {
  console.log(
    "apps/api/test/reconcile-runs.test.ts: DATABASE_URL not set — skipping (see docker-compose.yml + apps/api/.env.example)."
  );
}

describeIfDb(
  "reconcileOrphanedRuns (integration, requires DATABASE_URL)",
  () => {
    let db: Kysely<Database>;
    let workspaceId: string;
    let conversationId: string;

    beforeAll(async () => {
      db = await setupTestDb();
    });

    beforeEach(async () => {
      await truncateAll(db);
      workspaceId = (await createWorkspace(db)).id;
      conversationId = (
        await createConversation(db, workspaceId, "Test conversation")
      ).id;
    });

    afterAll(async () => {
      await db.destroy();
    });

    it("marks a run left \"running\" by a previous process as failed and appends a run_failed event", async () => {
      const run = await createRun(db, {
        id: "run_orphaned",
        conversationId,
        workspaceId,
        question: "Q?",
        mode: "standard",
        modelConfig: [{ id: "model_a", provider: "mock" }],
        budget: getBudget("standard"),
      });
      await appendRunEvent(db, {
        runId: run.id,
        seq: 1,
        event: { type: "run_started", runId: run.id, timestamp: new Date().toISOString() },
      });
      await appendRunEvent(db, {
        runId: run.id,
        seq: 2,
        event: {
          type: "phase_started",
          runId: run.id,
          timestamp: new Date().toISOString(),
          phase: "propose",
        },
      });

      const reconciledCount = await reconcileOrphanedRuns(db);
      expect(reconciledCount).toBe(1);

      const updated = await getRun(db, run.id);
      expect(updated?.status).toBe("failed");
      expect(updated?.error).toBe(RESTART_INTERRUPTED_MESSAGE);

      const events = await listRunEventsSince(db, run.id, 0);
      expect(events).toHaveLength(3);
      const lastEvent = events[events.length - 1];
      expect(lastEvent.seq).toBe(3);
      expect(lastEvent.type).toBe("run_failed");
      expect(lastEvent.data).toMatchObject({
        reason: "server_restart",
        message: RESTART_INTERRUPTED_MESSAGE,
      });
    });

    it("leaves completed/failed runs untouched and is a no-op when nothing is orphaned", async () => {
      const run = await createRun(db, {
        id: "run_already_done",
        conversationId,
        workspaceId,
        question: "Q?",
        mode: "standard",
        modelConfig: [{ id: "model_a", provider: "mock" }],
        budget: getBudget("standard"),
      });
      await db
        .updateTable("runs")
        .set({ status: "completed", completed_at: new Date() })
        .where("id", "=", run.id)
        .execute();

      const reconciledCount = await reconcileOrphanedRuns(db);
      expect(reconciledCount).toBe(0);

      const updated = await getRun(db, run.id);
      expect(updated?.status).toBe("completed");
    });

    it("assigns the next seq after existing events, not a hardcoded one, when a run has no events at all", async () => {
      const run = await createRun(db, {
        id: "run_no_events",
        conversationId,
        workspaceId,
        question: "Q?",
        mode: "standard",
        modelConfig: [{ id: "model_a", provider: "mock" }],
        budget: getBudget("standard"),
      });

      await reconcileOrphanedRuns(db);

      const events = await listRunEventsSince(db, run.id, 0);
      expect(events).toHaveLength(1);
      expect(events[0].seq).toBe(1);
      expect(events[0].type).toBe("run_failed");
    });
  }
);

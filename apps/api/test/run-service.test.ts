import { MockProvider } from "@mmd/model-adapters";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/client.js";
import { RunService } from "../src/services/run-service.js";
import { RunBroadcaster } from "../src/sse/broadcaster.js";
import { createConversation } from "../src/repositories/conversations-repo.js";
import { createWorkspace } from "../src/repositories/workspaces-repo.js";
import { hasTestDatabase, setupTestDb, truncateAll } from "./db-helpers.js";

const describeIfDb = hasTestDatabase() ? describe : describe.skip;
if (!hasTestDatabase()) {
  console.log(
    "apps/api/test/run-service.test.ts: DATABASE_URL not set — skipping (see docker-compose.yml + apps/api/.env.example)."
  );
}

const models = [
  { id: "model_a", provider: "mock" },
  { id: "model_b", provider: "mock" },
  { id: "model_c", provider: "mock" },
];

async function waitUntilTerminal(db: Kysely<Database>, runId: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const row = await db
      .selectFrom("runs")
      .select("status")
      .where("id", "=", runId)
      .executeTakeFirst();
    if (row && row.status !== "running") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`run ${runId} never reached a terminal status within the timeout`);
}

describeIfDb("RunService — M6.4 ephemeral token events (integration, requires DATABASE_URL)", () => {
  let db: Kysely<Database>;
  let workspaceId: string;
  let conversationId: string;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    workspaceId = (await createWorkspace(db)).id;
    conversationId = (await createConversation(db, workspaceId, "Test")).id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("never persists a token event to run_events, but does persist phase/model_responded/item_progress events", async () => {
    const broadcaster = new RunBroadcaster();
    const service = new RunService(db, broadcaster);

    const { runId } = await service.start({
      conversationId,
      workspaceId,
      question: "Should a small team adopt a monorepo?",
      mode: "standard",
      models,
      provider: new MockProvider({ streaming: true }),
    });

    await waitUntilTerminal(db, runId);

    const persistedTypes = await db
      .selectFrom("run_events")
      .select("type")
      .where("run_id", "=", runId)
      .execute();

    expect(persistedTypes.some((r) => r.type === "token")).toBe(false);
    expect(persistedTypes.some((r) => r.type === "phase_completed")).toBe(true);
    expect(persistedTypes.some((r) => r.type === "model_responded")).toBe(true);
    expect(persistedTypes.some((r) => r.type === "item_progress")).toBe(true);
  });

  it("broadcasts token events (ephemeral, no DB seq) interleaved in order with persisted events, via a live SSE subscriber", async () => {
    const broadcaster = new RunBroadcaster();
    const service = new RunService(db, broadcaster);

    const writes: string[] = [];
    const fakeRes = {
      write: (chunk: string) => {
        writes.push(chunk);
        return true;
      },
      end: () => {},
    } as unknown as import("node:http").ServerResponse;

    const { runId } = await service.start({
      conversationId,
      workspaceId,
      question: "Should a small team adopt a monorepo?",
      mode: "standard",
      models,
      provider: new MockProvider({ streaming: true }),
    });

    broadcaster.subscribe(runId, fakeRes);
    await waitUntilTerminal(db, runId);
    // Give the broadcaster's async eventChain a moment to flush the final
    // writes after the terminal DB row appears.
    await new Promise((r) => setTimeout(r, 50));

    const idLines = writes.filter((w) => w.startsWith("id: "));
    const tokenEventLines = writes.filter((w) => w === "event: token\n");
    // token events never carry an id: line — every id: line belongs to a
    // persisted, seq-bearing event.
    expect(tokenEventLines.length).toBeGreaterThan(0);
    expect(idLines.length).toBeGreaterThan(0);

    // Ordering: within the raw write stream, a "phase_started" for compose
    // must appear before any of compose's token events, which must appear
    // before compose's "phase_completed" — proving relative order survives
    // the ephemeral/persisted split.
    const composeStartIdx = writes.findIndex(
      (w, i) => w === "event: phase_started\n" && writes[i + 1]?.includes('"compose"')
    );
    const firstTokenIdx = writes.indexOf("event: token\n");
    const composeCompletedIdx = writes.findIndex(
      (w, i) => w === "event: phase_completed\n" && writes[i + 1]?.includes('"compose"')
    );
    expect(composeStartIdx).toBeGreaterThanOrEqual(0);
    expect(firstTokenIdx).toBeGreaterThan(composeStartIdx);
    expect(composeCompletedIdx).toBeGreaterThan(firstTokenIdx);
  });
});

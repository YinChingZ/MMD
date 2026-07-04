import { MockProvider } from "@mmd/model-adapters";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { buildProvider, type ResolvedProvider } from "../src/config/provider-factory.js";
import type { Database } from "../src/db/client.js";
import { hasTestDatabase, setupTestDb, truncateAll } from "./db-helpers.js";

const describeIfDb = hasTestDatabase() ? describe : describe.skip;
if (!hasTestDatabase()) {
  console.log(
    "apps/api/test/routes.test.ts: DATABASE_URL not set — skipping (see docker-compose.yml + apps/api/.env.example)."
  );
}

async function createConversationViaApi(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/conversations",
    payload: { title: "T" },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

async function pollUntilSettled(
  app: FastifyInstance,
  runId: string
): Promise<string> {
  let status = "running";
  for (let i = 0; i < 100 && status === "running"; i++) {
    const res = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    status = res.json().status;
    if (status === "running") await new Promise((r) => setTimeout(r, 50));
  }
  return status;
}

describeIfDb("apps/api routes (integration, requires DATABASE_URL)", () => {
  let db: Kysely<Database>;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    app = buildApp({
      db,
      resolvedProvider: buildProvider(undefined),
      logger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("creates a conversation, starts a run, and the run completes with a schema-valid result reachable via GET /result", async () => {
    const conversationId = await createConversationViaApi(app);

    const createRunRes = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/runs`,
      payload: { question: "Should a small team adopt a monorepo?", mode: "quick" },
    });
    expect(createRunRes.statusCode).toBe(201);
    const { runId, status: initialStatus } = createRunRes.json();
    expect(typeof runId).toBe("string");
    expect(initialStatus).toBe("running");

    const status = await pollUntilSettled(app, runId);
    expect(status).toBe("completed");

    const resultRes = await app.inject({
      method: "GET",
      url: `/api/runs/${runId}/result`,
    });
    expect(resultRes.statusCode).toBe(200);
    const body = resultRes.json();
    expect(body.final.final_answer.length).toBeGreaterThan(0);
  });

  it("rejects a run-creation request for an unknown modelId", async () => {
    const conversationId = await createConversationViaApi(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/runs`,
      payload: { question: "Q?", modelIds: ["not_a_real_model"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s when creating a run under a non-existent conversation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/conversations/00000000-0000-0000-0000-000000000000/runs",
      payload: { question: "Q?" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("replays the full persisted event log over SSE after the run has completed (page-refresh/reconnect scenario)", async () => {
    const conversationId = await createConversationViaApi(app);
    const createRunRes = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/runs`,
      payload: { question: "Q?", mode: "quick" },
    });
    const { runId } = createRunRes.json();
    await pollUntilSettled(app, runId);

    const eventsRes = await app.inject({
      method: "GET",
      url: `/api/runs/${runId}/events`,
    });
    expect(eventsRes.statusCode).toBe(200);
    expect(eventsRes.payload).toContain("event: run_started");
    expect(eventsRes.payload).toContain("event: run_completed");

    const seqs = [...eventsRes.payload.matchAll(/^id: (\d+)$/gm)].map((m) =>
      Number(m[1])
    );
    expect(seqs.length).toBeGreaterThan(0);
    // Ascending, contiguous — proves events were persisted/replayed in emission order.
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    const maxSeq = Math.max(...seqs);
    const resumeRes = await app.inject({
      method: "GET",
      url: `/api/runs/${runId}/events`,
      headers: { "last-event-id": String(maxSeq) },
    });
    expect(resumeRes.payload.trim()).toBe("");
  });

  it("marks a run failed (not a crashed process) when quorum is not met, and surfaces the reason", async () => {
    const failingProvider: ResolvedProvider = {
      provider: new MockProvider({
        failModelIds: new Set(["model_b", "model_c"]),
      }),
      availableModelIds: ["model_a", "model_b", "model_c"],
      isMock: true,
      modelIdToProviderLabel: () => "mock",
    };
    const failApp = buildApp({
      db,
      resolvedProvider: failingProvider,
      logger: false,
    });
    await failApp.ready();
    try {
      const conversationId = await createConversationViaApi(failApp);
      const createRunRes = await failApp.inject({
        method: "POST",
        url: `/api/conversations/${conversationId}/runs`,
        payload: { question: "Q?", mode: "standard" },
      });
      const { runId } = createRunRes.json();

      const status = await pollUntilSettled(failApp, runId);
      expect(status).toBe("failed");

      const runRes = await failApp.inject({
        method: "GET",
        url: `/api/runs/${runId}`,
      });
      expect(runRes.json().error).toMatch(/quorum/);

      const resultRes = await failApp.inject({
        method: "GET",
        url: `/api/runs/${runId}/result`,
      });
      expect(resultRes.statusCode).toBe(422);
    } finally {
      await failApp.close();
    }
  });
});

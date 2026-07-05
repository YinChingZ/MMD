import { MockProvider } from "@mmd/model-adapters";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7);

/**
 * No login — every visitor gets an anonymous workspace cookie (see
 * src/middleware/workspace.ts). app.inject() doesn't carry cookies across
 * separate calls the way a browser would, so tests must capture the
 * Set-Cookie from the first request and thread it through every subsequent
 * call that needs to stay in the same workspace.
 */
function extractWorkspaceCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.split(";")[0] : undefined;
}

async function createConversationViaApi(
  app: FastifyInstance,
  cookie?: string
): Promise<{ id: string; cookie: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/conversations",
    payload: { title: "T" },
    headers: cookie ? { cookie } : undefined,
  });
  expect(res.statusCode).toBe(201);
  const resolvedCookie = extractWorkspaceCookie(res) ?? cookie;
  if (!resolvedCookie) {
    throw new Error("expected a workspace cookie to be issued");
  }
  return { id: res.json().id, cookie: resolvedCookie };
}

async function pollUntilSettled(
  app: FastifyInstance,
  runId: string,
  cookie: string
): Promise<string> {
  let status = "running";
  for (let i = 0; i < 100 && status === "running"; i++) {
    const res = await app.inject({
      method: "GET",
      url: `/api/runs/${runId}`,
      headers: { cookie },
    });
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
      encryptionKey: TEST_ENCRYPTION_KEY,
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

  it("lists conversations most-recently-updated first", async () => {
    const first = await createConversationViaApi(app);
    const second = await createConversationViaApi(app, first.cookie);

    const res = await app.inject({
      method: "GET",
      url: "/api/conversations",
      headers: { cookie: second.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { conversations } = res.json();
    expect(conversations.map((c: { id: string }) => c.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it("does not show one workspace's conversations to another (no login, cookie-scoped history)", async () => {
    const ownerConversation = await createConversationViaApi(app);

    const strangerRes = await app.inject({
      method: "GET",
      url: "/api/conversations",
    });
    expect(strangerRes.statusCode).toBe(200);
    expect(strangerRes.json().conversations).toEqual([]);

    const strangerCookie = extractWorkspaceCookie(strangerRes);
    expect(strangerCookie).toBeDefined();
    expect(strangerCookie).not.toBe(ownerConversation.cookie);

    const strangerAccessRes = await app.inject({
      method: "GET",
      url: `/api/conversations/${ownerConversation.id}`,
      headers: { cookie: strangerCookie! },
    });
    expect(strangerAccessRes.statusCode).toBe(404);

    const ownerAccessRes = await app.inject({
      method: "GET",
      url: `/api/conversations/${ownerConversation.id}`,
      headers: { cookie: ownerConversation.cookie },
    });
    expect(ownerAccessRes.statusCode).toBe(200);
  });

  it("creates a conversation, starts a run, and the run completes with a schema-valid result reachable via GET /result", async () => {
    const conversation = await createConversationViaApi(app);

    const createRunRes = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/runs`,
      payload: { question: "Should a small team adopt a monorepo?", mode: "quick" },
      headers: { cookie: conversation.cookie },
    });
    expect(createRunRes.statusCode).toBe(201);
    const { runId, status: initialStatus } = createRunRes.json();
    expect(typeof runId).toBe("string");
    expect(initialStatus).toBe("running");

    const status = await pollUntilSettled(app, runId, conversation.cookie);
    expect(status).toBe("completed");

    const resultRes = await app.inject({
      method: "GET",
      url: `/api/runs/${runId}/result`,
      headers: { cookie: conversation.cookie },
    });
    expect(resultRes.statusCode).toBe(200);
    const body = resultRes.json();
    expect(body.final.final_answer.length).toBeGreaterThan(0);
  });

  it("rejects a run-creation request for an unknown modelId", async () => {
    const conversation = await createConversationViaApi(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/runs`,
      payload: { question: "Q?", modelIds: ["not_a_real_model"] },
      headers: { cookie: conversation.cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a run-creation request for an unsupported BYOK provider id", async () => {
    const conversation = await createConversationViaApi(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/runs`,
      payload: {
        question: "Q?",
        byokModels: [
          {
            providerId: "not-a-whitelisted-provider",
            modelId: "some-model",
            apiKey: "sk-test",
          },
        ],
      },
      headers: { cookie: conversation.cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unsupported provider/);
  });

  it("rejects a byok label that collides with a selected legacy model id", async () => {
    const conversation = await createConversationViaApi(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/runs`,
      payload: {
        question: "Q?",
        modelIds: ["model_a"],
        byokModels: [
          {
            providerId: "openai",
            modelId: "gpt-4.1-mini",
            apiKey: "sk-test",
            label: "model_a",
          },
        ],
      },
      headers: { cookie: conversation.cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/used by both/);
  });

  it("creates a run mixing a legacy model and a BYOK model without ever persisting the caller's api key", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network disabled in test"));
    try {
      const conversation = await createConversationViaApi(app);
      const createRunRes = await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/runs`,
        payload: {
          question: "Q?",
          mode: "quick",
          modelIds: ["model_a"],
          byokModels: [
            {
              providerId: "openai",
              modelId: "gpt-4.1-mini",
              apiKey: "sk-should-never-be-persisted",
              label: "my_openai",
            },
          ],
        },
        headers: { cookie: conversation.cookie },
      });
      expect(createRunRes.statusCode).toBe(201);
      const { runId } = createRunRes.json();

      const persisted = await db
        .selectFrom("runs")
        .select(["model_config"])
        .where("id", "=", runId)
        .executeTakeFirstOrThrow();
      const modelConfig = persisted.model_config;
      expect(modelConfig).toEqual([
        { id: "model_a", provider: "mock" },
        { id: "my_openai", provider: "OpenAI" },
      ]);
      expect(JSON.stringify(modelConfig)).not.toContain(
        "sk-should-never-be-persisted"
      );

      // Let the background deliberation settle (it'll fail — fetch is
      // stubbed to reject — but we don't care about the outcome here, only
      // that it doesn't leave dangling async work for the next test).
      await pollUntilSettled(app, runId, conversation.cookie);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("persists a byok key under the workspace when save is true, exposes only metadata via GET /api/workspace/keys, and never leaks the plaintext into that workspace's saved-key row", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network disabled in test"));
    try {
      const conversation = await createConversationViaApi(app);
      const createRunRes = await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/runs`,
        payload: {
          question: "Q?",
          mode: "quick",
          byokModels: [
            {
              providerId: "openai",
              modelId: "gpt-4.1-mini",
              apiKey: "sk-remember-me",
              label: "my_openai",
              save: true,
            },
          ],
        },
        headers: { cookie: conversation.cookie },
      });
      expect(createRunRes.statusCode).toBe(201);
      const { runId } = createRunRes.json();

      const keysRes = await app.inject({
        method: "GET",
        url: "/api/workspace/keys",
        headers: { cookie: conversation.cookie },
      });
      expect(keysRes.statusCode).toBe(200);
      const { keys } = keysRes.json();
      expect(keys).toEqual([
        {
          id: expect.any(String),
          providerId: "openai",
          modelId: "gpt-4.1-mini",
          label: "my_openai",
          createdAt: expect.any(String),
        },
      ]);
      expect(JSON.stringify(keys)).not.toContain("sk-remember-me");

      const row = await db
        .selectFrom("workspace_api_keys")
        .select(["encrypted_key"])
        .where("id", "=", keys[0].id)
        .executeTakeFirstOrThrow();
      expect(row.encrypted_key.toString("latin1")).not.toContain(
        "sk-remember-me"
      );

      // A different workspace must not see this saved key.
      const strangerKeysRes = await app.inject({
        method: "GET",
        url: "/api/workspace/keys",
      });
      expect(strangerKeysRes.json().keys).toEqual([]);

      await pollUntilSettled(app, runId, conversation.cookie);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reuses a saved key via savedKeyId without the client ever resending the plaintext", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network disabled in test"));
    try {
      const conversation = await createConversationViaApi(app);

      // First run: save a key.
      const firstRunRes = await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/runs`,
        payload: {
          question: "Q?",
          mode: "quick",
          byokModels: [
            {
              providerId: "openai",
              modelId: "gpt-4.1-mini",
              apiKey: "sk-reuse-me",
              label: "my_openai",
              save: true,
            },
          ],
        },
        headers: { cookie: conversation.cookie },
      });
      const { runId: firstRunId } = firstRunRes.json();
      await pollUntilSettled(app, firstRunId, conversation.cookie);

      const keysRes = await app.inject({
        method: "GET",
        url: "/api/workspace/keys",
        headers: { cookie: conversation.cookie },
      });
      const savedKeyId = keysRes.json().keys[0].id as string;

      // Second run: reuse it by id only — no apiKey/providerId/modelId in
      // the payload at all, proving the server derives them from storage.
      const secondRunRes = await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/runs`,
        payload: {
          question: "Q2?",
          mode: "quick",
          byokModels: [{ savedKeyId }],
        },
        headers: { cookie: conversation.cookie },
      });
      expect(secondRunRes.statusCode).toBe(201);
      const { runId: secondRunId } = secondRunRes.json();

      const persisted = await db
        .selectFrom("runs")
        .select(["model_config"])
        .where("id", "=", secondRunId)
        .executeTakeFirstOrThrow();
      expect(persisted.model_config).toEqual([
        { id: "my_openai", provider: "OpenAI" },
      ]);
      expect(JSON.stringify(persisted.model_config)).not.toContain(
        "sk-reuse-me"
      );

      // Confirm the actual outbound call used the decrypted saved key.
      await pollUntilSettled(app, secondRunId, conversation.cookie);
      const call = fetchSpy.mock.calls.find(([url]) =>
        String(url).includes("api.openai.com")
      );
      expect(call).toBeDefined();
      const init = call![1] as { headers: Record<string, string> };
      expect(init.headers.Authorization).toBe("Bearer sk-reuse-me");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("M5.1: persists a caller-supplied pricing override alongside a saved byok key, and a later run can override it again", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network disabled in test"));
    try {
      const conversation = await createConversationViaApi(app);

      const firstRunRes = await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/runs`,
        payload: {
          question: "Q?",
          mode: "quick",
          byokModels: [
            {
              providerId: "openai",
              modelId: "gpt-4.1-mini",
              apiKey: "sk-with-rate",
              label: "my_openai",
              save: true,
              pricing: { inputPerMillion: 3, outputPerMillion: 9 },
            },
          ],
        },
        headers: { cookie: conversation.cookie },
      });
      expect(firstRunRes.statusCode).toBe(201);
      const { runId: firstRunId } = firstRunRes.json();
      await pollUntilSettled(app, firstRunId, conversation.cookie);

      const keysRes = await app.inject({
        method: "GET",
        url: "/api/workspace/keys",
        headers: { cookie: conversation.cookie },
      });
      const savedKey = keysRes.json().keys[0];
      expect(savedKey.pricing).toEqual({ inputPerMillion: 3, outputPerMillion: 9 });

      const row = await db
        .selectFrom("workspace_api_keys")
        .select(["input_per_million", "output_per_million"])
        .where("id", "=", savedKey.id)
        .executeTakeFirstOrThrow();
      expect(row.input_per_million).toBe(3);
      expect(row.output_per_million).toBe(9);

      // Saving again for the same (workspace, provider, model) with a
      // different rate replaces the stored one, same upsert semantics as
      // the key/label themselves.
      await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/runs`,
        payload: {
          question: "Q2?",
          mode: "quick",
          byokModels: [
            {
              providerId: "openai",
              modelId: "gpt-4.1-mini",
              apiKey: "sk-with-rate",
              label: "my_openai",
              save: true,
              pricing: { inputPerMillion: 10, outputPerMillion: 20 },
            },
          ],
        },
        headers: { cookie: conversation.cookie },
      });
      const updatedRow = await db
        .selectFrom("workspace_api_keys")
        .select(["input_per_million", "output_per_million"])
        .where("id", "=", savedKey.id)
        .executeTakeFirstOrThrow();
      expect(updatedRow.input_per_million).toBe(10);
      expect(updatedRow.output_per_million).toBe(20);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects a run-creation request referencing an unknown/foreign savedKeyId", async () => {
    const conversation = await createConversationViaApi(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/runs`,
      payload: {
        question: "Q?",
        byokModels: [{ savedKeyId: "00000000-0000-0000-0000-000000000000" }],
      },
      headers: { cookie: conversation.cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unknown saved key id/);
  });

  it("does not persist a byok key when save is omitted/false", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network disabled in test"));
    try {
      const conversation = await createConversationViaApi(app);
      const createRunRes = await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/runs`,
        payload: {
          question: "Q?",
          mode: "quick",
          byokModels: [
            {
              providerId: "openai",
              modelId: "gpt-4.1-mini",
              apiKey: "sk-do-not-remember",
              label: "my_openai",
            },
          ],
        },
        headers: { cookie: conversation.cookie },
      });
      expect(createRunRes.statusCode).toBe(201);
      const { runId } = createRunRes.json();

      const keysRes = await app.inject({
        method: "GET",
        url: "/api/workspace/keys",
        headers: { cookie: conversation.cookie },
      });
      expect(keysRes.json().keys).toEqual([]);

      await pollUntilSettled(app, runId, conversation.cookie);
    } finally {
      fetchSpy.mockRestore();
    }
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
    const conversation = await createConversationViaApi(app);
    const createRunRes = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/runs`,
      payload: { question: "Q?", mode: "quick" },
      headers: { cookie: conversation.cookie },
    });
    const { runId } = createRunRes.json();
    await pollUntilSettled(app, runId, conversation.cookie);

    const eventsRes = await app.inject({
      method: "GET",
      url: `/api/runs/${runId}/events`,
      headers: { cookie: conversation.cookie },
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
      headers: { "last-event-id": String(maxSeq), cookie: conversation.cookie },
    });
    expect(resumeRes.payload.trim()).toBe("");
  });

  it("does not let a different workspace access another's run status/result/events (404, not 403)", async () => {
    const conversation = await createConversationViaApi(app);
    const createRunRes = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/runs`,
      payload: { question: "Q?", mode: "quick" },
      headers: { cookie: conversation.cookie },
    });
    const { runId } = createRunRes.json();
    await pollUntilSettled(app, runId, conversation.cookie);

    const strangerStatusRes = await app.inject({
      method: "GET",
      url: `/api/runs/${runId}`,
    });
    expect(strangerStatusRes.statusCode).toBe(404);

    const strangerResultRes = await app.inject({
      method: "GET",
      url: `/api/runs/${runId}/result`,
    });
    expect(strangerResultRes.statusCode).toBe(404);

    const strangerEventsRes = await app.inject({
      method: "GET",
      url: `/api/runs/${runId}/events`,
    });
    expect(strangerEventsRes.statusCode).toBe(404);
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
      encryptionKey: TEST_ENCRYPTION_KEY,
      logger: false,
    });
    await failApp.ready();
    try {
      const conversation = await createConversationViaApi(failApp);
      const createRunRes = await failApp.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/runs`,
        payload: { question: "Q?", mode: "standard" },
        headers: { cookie: conversation.cookie },
      });
      const { runId } = createRunRes.json();

      const status = await pollUntilSettled(failApp, runId, conversation.cookie);
      expect(status).toBe("failed");

      const runRes = await failApp.inject({
        method: "GET",
        url: `/api/runs/${runId}`,
        headers: { cookie: conversation.cookie },
      });
      expect(runRes.json().error).toMatch(/quorum/);

      const resultRes = await failApp.inject({
        method: "GET",
        url: `/api/runs/${runId}/result`,
        headers: { cookie: conversation.cookie },
      });
      expect(resultRes.statusCode).toBe(422);
    } finally {
      await failApp.close();
    }
  });

  it("M5.1: applies a default cost limit when the request omits costLimitUsd, marking the run failed instead of letting it run unprotected", async () => {
    const expensiveProvider: ResolvedProvider = {
      provider: new MockProvider({ costPerCallUsd: 10 }),
      availableModelIds: ["model_a", "model_b", "model_c"],
      isMock: true,
      modelIdToProviderLabel: () => "mock",
    };
    const expensiveApp = buildApp({
      db,
      resolvedProvider: expensiveProvider,
      encryptionKey: TEST_ENCRYPTION_KEY,
      logger: false,
    });
    await expensiveApp.ready();
    try {
      const conversation = await createConversationViaApi(expensiveApp);
      const createRunRes = await expensiveApp.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/runs`,
        // No costLimitUsd supplied — the route's DEFAULT_COST_LIMIT_USD ($5)
        // should apply on its own, since 3 models x $10/call blows well past it.
        payload: { question: "Q?", mode: "standard" },
        headers: { cookie: conversation.cookie },
      });
      const { runId } = createRunRes.json();

      const status = await pollUntilSettled(expensiveApp, runId, conversation.cookie);
      expect(status).toBe("failed");

      const runRes = await expensiveApp.inject({
        method: "GET",
        url: `/api/runs/${runId}`,
        headers: { cookie: conversation.cookie },
      });
      expect(runRes.json().error).toMatch(/cost limit exceeded/);
    } finally {
      await expensiveApp.close();
    }
  });

  it("M5.1: an explicit costLimitUsd overrides the default, letting an otherwise-over-default-budget run complete", async () => {
    const expensiveProvider: ResolvedProvider = {
      provider: new MockProvider({ costPerCallUsd: 10 }),
      availableModelIds: ["model_a", "model_b", "model_c"],
      isMock: true,
      modelIdToProviderLabel: () => "mock",
    };
    const expensiveApp = buildApp({
      db,
      resolvedProvider: expensiveProvider,
      encryptionKey: TEST_ENCRYPTION_KEY,
      logger: false,
    });
    await expensiveApp.ready();
    try {
      const conversation = await createConversationViaApi(expensiveApp);
      const createRunRes = await expensiveApp.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/runs`,
        payload: { question: "Q?", mode: "quick", costLimitUsd: 1000 },
        headers: { cookie: conversation.cookie },
      });
      const { runId } = createRunRes.json();

      const status = await pollUntilSettled(expensiveApp, runId, conversation.cookie);
      expect(status).toBe("completed");

      const resultRes = await expensiveApp.inject({
        method: "GET",
        url: `/api/runs/${runId}/result`,
        headers: { cookie: conversation.cookie },
      });
      expect(resultRes.statusCode).toBe(200);
      expect(resultRes.json().cost.totalUsd).toBeGreaterThan(5);
      expect(resultRes.json().cost.limitUsd).toBe(1000);
    } finally {
      await expensiveApp.close();
    }
  });

  it("M5.3: DELETE /api/conversations/:id removes the conversation (and cascades to its runs), 404s afterward", async () => {
    const conversation = await createConversationViaApi(app);
    const createRunRes = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/runs`,
      payload: { question: "Q?", mode: "quick" },
      headers: { cookie: conversation.cookie },
    });
    const { runId } = createRunRes.json();
    await pollUntilSettled(app, runId, conversation.cookie);

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${conversation.id}`,
      headers: { cookie: conversation.cookie },
    });
    expect(deleteRes.statusCode).toBe(204);

    const getConversationRes = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversation.id}`,
      headers: { cookie: conversation.cookie },
    });
    expect(getConversationRes.statusCode).toBe(404);

    const getRunRes = await app.inject({
      method: "GET",
      url: `/api/runs/${runId}`,
      headers: { cookie: conversation.cookie },
    });
    expect(getRunRes.statusCode).toBe(404);
  });

  it("M5.3: DELETE /api/conversations/:id 404s (and doesn't delete) a conversation belonging to another workspace", async () => {
    const ownerConversation = await createConversationViaApi(app);

    const strangerRes = await app.inject({
      method: "GET",
      url: "/api/conversations",
    });
    const strangerCookie = extractWorkspaceCookie(strangerRes)!;

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${ownerConversation.id}`,
      headers: { cookie: strangerCookie },
    });
    expect(deleteRes.statusCode).toBe(404);

    const stillThereRes = await app.inject({
      method: "GET",
      url: `/api/conversations/${ownerConversation.id}`,
      headers: { cookie: ownerConversation.cookie },
    });
    expect(stillThereRes.statusCode).toBe(200);
  });

  it("M5.3: rate-limits POST /api/conversations/:id/runs per workspace, returning 429 past the threshold", async () => {
    const conversation = await createConversationViaApi(app);

    const responses = [];
    for (let i = 0; i < 11; i++) {
      responses.push(
        await app.inject({
          method: "POST",
          url: `/api/conversations/${conversation.id}/runs`,
          payload: { question: `Q${i}?`, mode: "quick" },
          headers: { cookie: conversation.cookie },
        })
      );
    }

    const statusCodes = responses.map((r) => r.statusCode);
    expect(statusCodes.slice(0, 10)).toEqual(Array(10).fill(201));
    expect(statusCodes[10]).toBe(429);

    // A different workspace isn't affected by the first workspace's limit.
    const otherConversation = await createConversationViaApi(app);
    const otherRes = await app.inject({
      method: "POST",
      url: `/api/conversations/${otherConversation.id}/runs`,
      payload: { question: "Q?", mode: "quick" },
      headers: { cookie: otherConversation.cookie },
    });
    expect(otherRes.statusCode).toBe(201);

    // Drain every triggered run to completion before the test ends — the
    // 429 responses aside, the other 11 real (mock) runs kicked off async
    // work that must not still be in flight when afterEach tears down the
    // db/app, or its writes race the next test's truncateAll.
    await Promise.all([
      ...responses
        .slice(0, 10)
        .map((r) => pollUntilSettled(app, r.json().runId, conversation.cookie)),
      pollUntilSettled(app, otherRes.json().runId, otherConversation.cookie),
    ]);
  });
});

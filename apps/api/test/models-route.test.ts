import { MockProvider } from "@mmd/model-adapters";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ResolvedProvider } from "../src/config/provider-factory.js";
import { buildProvider } from "../src/config/provider-factory.js";
import type { Database } from "../src/db/client.js";
import type { Kysely } from "kysely";

describe("GET /api/models", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildApp({
      db: {} as Kysely<Database>,
      resolvedProvider: buildProvider(undefined),
      logger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("lists the mock provider's models", async () => {
    const res = await app.inject({ method: "GET", url: "/api/models" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.models).toEqual([
      { id: "model_a", providerLabel: "mock", isCoordinator: false },
      { id: "model_b", providerLabel: "mock", isCoordinator: false },
      { id: "model_c", providerLabel: "mock", isCoordinator: false },
    ]);
  });

  it("marks the configured coordinator model", async () => {
    const resolvedProvider: ResolvedProvider = {
      provider: new MockProvider(),
      availableModelIds: ["model_a", "model_b"],
      coordinatorModelId: "model_b",
      isMock: true,
      modelIdToProviderLabel: () => "mock",
    };
    const coordApp = buildApp({
      db: {} as Kysely<Database>,
      resolvedProvider,
      logger: false,
    });
    await coordApp.ready();
    try {
      const res = await coordApp.inject({ method: "GET", url: "/api/models" });
      const body = res.json();
      expect(body.models.find((m: { id: string }) => m.id === "model_b").isCoordinator).toBe(
        true
      );
      expect(body.models.find((m: { id: string }) => m.id === "model_a").isCoordinator).toBe(
        false
      );
    } finally {
      await coordApp.close();
    }
  });
});

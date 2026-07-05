import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { buildProvider } from "../src/config/provider-factory.js";
import type { Database } from "../src/db/client.js";

describe("GET /api/providers", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildApp({
      db: {} as Kysely<Database>,
      resolvedProvider: buildProvider(undefined),
      encryptionKey: Buffer.alloc(32, 7),
      logger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("lists the BYOK provider whitelist by providerId/displayName only, never a baseUrl", async () => {
    const res = await app.inject({ method: "GET", url: "/api/providers" });
    expect(res.statusCode).toBe(200);
    const { providers } = res.json();
    expect(providers.length).toBeGreaterThan(0);
    const openai = providers.find((p: { providerId: string }) => p.providerId === "openai");
    expect(openai.displayName).toBe("OpenAI");
    for (const p of providers) {
      expect(Object.keys(p).sort()).not.toContain("baseUrl");
    }
  });

  it("M5.1: includes a suggestedRate for providers we have a built-in rate for, and omits it for openrouter", async () => {
    const res = await app.inject({ method: "GET", url: "/api/providers" });
    const { providers } = res.json();
    const byId = Object.fromEntries(
      providers.map((p: { providerId: string }) => [p.providerId, p])
    );
    expect(byId.openai.suggestedRate).toEqual(
      expect.objectContaining({
        inputPerMillion: expect.any(Number),
        outputPerMillion: expect.any(Number),
      })
    );
    // OpenRouter reports real cost directly — nothing to suggest, and the
    // field should be entirely absent from the JSON response, not just null.
    expect(byId.openrouter).not.toHaveProperty("suggestedRate");
  });
});

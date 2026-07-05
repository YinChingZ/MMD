import { randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/client.js";
import {
  getDecryptedApiKey,
  listApiKeysForWorkspace,
  saveApiKey,
} from "../src/repositories/workspace-api-keys-repo.js";
import { createWorkspace } from "../src/repositories/workspaces-repo.js";
import { hasTestDatabase, setupTestDb, truncateAll } from "./db-helpers.js";

const describeIfDb = hasTestDatabase() ? describe : describe.skip;
if (!hasTestDatabase()) {
  console.log(
    "apps/api/test/workspace-api-keys.test.ts: DATABASE_URL not set — skipping (see docker-compose.yml + apps/api/.env.example)."
  );
}

const ENCRYPTION_KEY = randomBytes(32);

describeIfDb(
  "workspace-api-keys-repo (integration, requires DATABASE_URL)",
  () => {
    let db: Kysely<Database>;
    let workspaceId: string;

    beforeAll(async () => {
      db = await setupTestDb();
    });

    beforeEach(async () => {
      await truncateAll(db);
      workspaceId = (await createWorkspace(db)).id;
    });

    afterAll(async () => {
      await db.destroy();
    });

    it("saves a key, lists only metadata (never the key), and decrypts it back for the owning workspace", async () => {
      const saved = await saveApiKey(db, ENCRYPTION_KEY, {
        workspaceId,
        providerId: "openai",
        modelId: "gpt-4.1-mini",
        apiKey: "sk-round-trip-value",
        label: "my openai key",
      });
      expect(saved.providerId).toBe("openai");
      expect(saved.modelId).toBe("gpt-4.1-mini");
      expect(saved.label).toBe("my openai key");
      expect(saved).not.toHaveProperty("apiKey");
      expect(saved).not.toHaveProperty("encryptedKey");

      const listed = await listApiKeysForWorkspace(db, workspaceId);
      expect(listed).toEqual([saved]);
      expect(JSON.stringify(listed)).not.toContain("sk-round-trip-value");

      const decrypted = await getDecryptedApiKey(db, ENCRYPTION_KEY, {
        workspaceId,
        id: saved.id,
      });
      expect(decrypted).toEqual({
        providerId: "openai",
        modelId: "gpt-4.1-mini",
        label: "my openai key",
        apiKey: "sk-round-trip-value",
      });
    });

    it("the raw DB row's encrypted_key column never contains the plaintext key", async () => {
      const saved = await saveApiKey(db, ENCRYPTION_KEY, {
        workspaceId,
        providerId: "openai",
        modelId: "gpt-4.1-mini",
        apiKey: "sk-should-not-appear-in-storage",
      });
      const row = await db
        .selectFrom("workspace_api_keys")
        .select(["encrypted_key"])
        .where("id", "=", saved.id)
        .executeTakeFirstOrThrow();
      expect(row.encrypted_key.toString("latin1")).not.toContain(
        "sk-should-not-appear-in-storage"
      );
    });

    it("upserts on (workspace_id, provider_id, model_id) — saving again replaces the key/label instead of duplicating rows", async () => {
      await saveApiKey(db, ENCRYPTION_KEY, {
        workspaceId,
        providerId: "openai",
        modelId: "gpt-4.1-mini",
        apiKey: "sk-first-value",
        label: "first",
      });
      const second = await saveApiKey(db, ENCRYPTION_KEY, {
        workspaceId,
        providerId: "openai",
        modelId: "gpt-4.1-mini",
        apiKey: "sk-second-value",
        label: "second",
      });

      const listed = await listApiKeysForWorkspace(db, workspaceId);
      expect(listed.length).toBe(1);
      expect(listed[0].label).toBe("second");

      const decrypted = await getDecryptedApiKey(db, ENCRYPTION_KEY, {
        workspaceId,
        id: second.id,
      });
      expect(decrypted?.apiKey).toBe("sk-second-value");
    });

    it("M5.1: persists a custom pricing rate alongside a saved key and returns it on reuse", async () => {
      const saved = await saveApiKey(db, ENCRYPTION_KEY, {
        workspaceId,
        providerId: "some-self-hosted-thing",
        modelId: "custom-model",
        apiKey: "sk-with-custom-rate",
        pricing: { inputPerMillion: 3, outputPerMillion: 9 },
      });
      expect(saved.pricing).toEqual({ inputPerMillion: 3, outputPerMillion: 9 });

      const listed = await listApiKeysForWorkspace(db, workspaceId);
      expect(listed[0].pricing).toEqual({ inputPerMillion: 3, outputPerMillion: 9 });

      const decrypted = await getDecryptedApiKey(db, ENCRYPTION_KEY, {
        workspaceId,
        id: saved.id,
      });
      expect(decrypted?.pricing).toEqual({ inputPerMillion: 3, outputPerMillion: 9 });
    });

    it("M5.1: saving without pricing leaves it undefined, and a later save can clear a previously-saved rate", async () => {
      const withRate = await saveApiKey(db, ENCRYPTION_KEY, {
        workspaceId,
        providerId: "openai",
        modelId: "gpt-4.1-mini",
        apiKey: "sk-first",
        pricing: { inputPerMillion: 1, outputPerMillion: 2 },
      });
      expect(withRate.pricing).toEqual({ inputPerMillion: 1, outputPerMillion: 2 });

      // Same (workspace, provider, model) — upsert without a pricing field clears it.
      const withoutRate = await saveApiKey(db, ENCRYPTION_KEY, {
        workspaceId,
        providerId: "openai",
        modelId: "gpt-4.1-mini",
        apiKey: "sk-second",
      });
      expect(withoutRate.pricing).toBeUndefined();
    });

    it("does not let a different workspace decrypt another workspace's saved key by id", async () => {
      const saved = await saveApiKey(db, ENCRYPTION_KEY, {
        workspaceId,
        providerId: "openai",
        modelId: "gpt-4.1-mini",
        apiKey: "sk-owner-only",
      });
      const otherWorkspaceId = (await createWorkspace(db)).id;

      const stolen = await getDecryptedApiKey(db, ENCRYPTION_KEY, {
        workspaceId: otherWorkspaceId,
        id: saved.id,
      });
      expect(stolen).toBeUndefined();

      const strangerList = await listApiKeysForWorkspace(db, otherWorkspaceId);
      expect(strangerList).toEqual([]);
    });
  }
);

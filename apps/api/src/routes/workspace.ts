import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { resolveWorkspace } from "../middleware/workspace.js";
import { listApiKeysForWorkspace } from "../repositories/workspace-api-keys-repo.js";

export async function workspaceRoutes(
  fastify: FastifyInstance,
  deps: AppDeps
): Promise<void> {
  fastify.addHook("onRequest", async (request, reply) => {
    request.workspaceId = await resolveWorkspace(deps.db, request, reply);
  });

  // Metadata only (providerId/modelId/label) — never the key itself, saved
  // or otherwise. Lets the web UI offer "reuse your saved OpenRouter key?"
  // without the browser ever holding the plaintext again.
  fastify.get("/api/workspace/keys", async (request, reply) => {
    const keys = await listApiKeysForWorkspace(deps.db, request.workspaceId);
    return reply.send({ keys });
  });
}

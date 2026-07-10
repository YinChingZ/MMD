import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { resolveWorkspace } from "../middleware/workspace.js";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversationTitle,
} from "../repositories/conversations-repo.js";
import { listRunsForConversation } from "../repositories/runs-repo.js";

const CreateConversationBody = z.object({
  title: z.string().min(1).optional(),
});

const UpdateConversationBody = z.object({
  title: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(200)),
});

export async function conversationsRoutes(
  fastify: FastifyInstance,
  deps: AppDeps
): Promise<void> {
  fastify.addHook("onRequest", async (request, reply) => {
    request.workspaceId = await resolveWorkspace(deps.db, request, reply);
  });

  fastify.post("/api/conversations", async (request, reply) => {
    const parsed = CreateConversationBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const conversation = await createConversation(
      deps.db,
      request.workspaceId,
      parsed.data.title
    );
    return reply.code(201).send(conversation);
  });

  fastify.get("/api/conversations", async (request, reply) => {
    const conversations = await listConversations(
      deps.db,
      request.workspaceId
    );
    return reply.send({ conversations });
  });

  fastify.get<{ Params: { id: string } }>(
    "/api/conversations/:id",
    async (request, reply) => {
      const conversation = await getConversation(deps.db, request.params.id);
      if (!conversation || conversation.workspaceId !== request.workspaceId) {
        return reply.code(404).send({ error: "conversation not found" });
      }
      const runs = await listRunsForConversation(deps.db, request.params.id);
      return reply.send({ ...conversation, runs });
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    "/api/conversations/:id",
    async (request, reply) => {
      const conversation = await getConversation(deps.db, request.params.id);
      if (!conversation || conversation.workspaceId !== request.workspaceId) {
        return reply.code(404).send({ error: "conversation not found" });
      }
      const parsed = UpdateConversationBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.message });
      }
      const updated = await updateConversationTitle(
        deps.db,
        request.params.id,
        parsed.data.title
      );
      return reply.send(updated);
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    "/api/conversations/:id",
    async (request, reply) => {
      const conversation = await getConversation(deps.db, request.params.id);
      if (!conversation || conversation.workspaceId !== request.workspaceId) {
        return reply.code(404).send({ error: "conversation not found" });
      }
      await deleteConversation(deps.db, request.params.id);
      return reply.code(204).send();
    }
  );
}

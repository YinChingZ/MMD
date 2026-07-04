import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import {
  createConversation,
  getConversation,
  listConversations,
} from "../repositories/conversations-repo.js";
import { listRunsForConversation } from "../repositories/runs-repo.js";

const CreateConversationBody = z.object({
  title: z.string().min(1).optional(),
});

export async function conversationsRoutes(
  fastify: FastifyInstance,
  deps: AppDeps
): Promise<void> {
  fastify.post("/api/conversations", async (request, reply) => {
    const parsed = CreateConversationBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const conversation = await createConversation(deps.db, parsed.data.title);
    return reply.code(201).send(conversation);
  });

  fastify.get("/api/conversations", async (_request, reply) => {
    const conversations = await listConversations(deps.db);
    return reply.send({ conversations });
  });

  fastify.get<{ Params: { id: string } }>(
    "/api/conversations/:id",
    async (request, reply) => {
      const conversation = await getConversation(deps.db, request.params.id);
      if (!conversation) {
        return reply.code(404).send({ error: "conversation not found" });
      }
      const runs = await listRunsForConversation(deps.db, request.params.id);
      return reply.send({ ...conversation, runs });
    }
  );
}

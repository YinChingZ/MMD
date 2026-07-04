import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { getConversation } from "../repositories/conversations-repo.js";
import { getRun } from "../repositories/runs-repo.js";
import { getResult } from "../repositories/results-repo.js";

const CreateRunBody = z.object({
  question: z.string().min(1),
  mode: z.enum(["standard", "quick", "planning"]).optional(),
  modelIds: z.array(z.string().min(1)).min(1).optional(),
});

export async function runsRoutes(
  fastify: FastifyInstance,
  deps: AppDeps
): Promise<void> {
  fastify.post<{ Params: { id: string } }>(
    "/api/conversations/:id/runs",
    async (request, reply) => {
      const conversation = await getConversation(deps.db, request.params.id);
      if (!conversation) {
        return reply.code(404).send({ error: "conversation not found" });
      }

      const parsed = CreateRunBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.message });
      }

      const { question, mode = "standard", modelIds } = parsed.data;
      const {
        availableModelIds,
        coordinatorModelId,
        provider,
        modelIdToProviderLabel,
      } = deps.resolvedProvider;

      const selectedIds = modelIds ?? availableModelIds;
      const unknownIds = selectedIds.filter(
        (id) => !availableModelIds.includes(id)
      );
      if (unknownIds.length) {
        return reply
          .code(400)
          .send({ error: `unknown model id(s): ${unknownIds.join(", ")}` });
      }

      const models = selectedIds.map((id) => ({
        id,
        provider: modelIdToProviderLabel(id),
      }));

      const { runId } = await deps.runService.start({
        conversationId: request.params.id,
        question,
        mode,
        models,
        provider,
        coordinatorModelId,
      });

      return reply.code(201).send({ runId, status: "running" });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/runs/:id",
    async (request, reply) => {
      const run = await getRun(deps.db, request.params.id);
      if (!run) return reply.code(404).send({ error: "run not found" });
      return reply.send(run);
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/runs/:id/result",
    async (request, reply) => {
      const run = await getRun(deps.db, request.params.id);
      if (!run) return reply.code(404).send({ error: "run not found" });
      if (run.status === "running") {
        return reply.code(409).send({ status: "running" });
      }
      if (run.status === "failed") {
        return reply.code(422).send({ status: "failed", error: run.error });
      }
      const result = await getResult(deps.db, request.params.id);
      if (!result) {
        return reply.code(404).send({ error: "result not found" });
      }
      return reply.send({
        runId: run.id,
        question: run.question,
        mode: run.mode,
        status: run.status,
        ...result,
      });
    }
  );
}

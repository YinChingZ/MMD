import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";

export async function modelsRoutes(
  fastify: FastifyInstance,
  deps: AppDeps
): Promise<void> {
  fastify.get("/api/models", async (_request, reply) => {
    const { availableModelIds, modelIdToProviderLabel, coordinatorModelId, isMock } =
      deps.resolvedProvider;
    return reply.send({
      models: availableModelIds.map((id) => ({
        id,
        providerLabel: modelIdToProviderLabel(id),
        isCoordinator: id === coordinatorModelId,
        isMock,
      })),
    });
  });
}

import type { FastifyInstance } from "fastify";
import { PROVIDER_WHITELIST } from "@mmd/protocol";
import type { AppDeps } from "../app.js";

export async function providersRoutes(
  fastify: FastifyInstance,
  _deps: AppDeps
): Promise<void> {
  fastify.get("/api/providers", async (_request, reply) => {
    return reply.send({
      providers: PROVIDER_WHITELIST.map(({ providerId, displayName }) => ({
        providerId,
        displayName,
      })),
    });
  });
}

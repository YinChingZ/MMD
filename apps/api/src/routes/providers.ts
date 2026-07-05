import type { FastifyInstance } from "fastify";
import { PROVIDER_WHITELIST, suggestedRateFor } from "@mmd/protocol";
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
        // M5.1 follow-up: a starting suggestion for the optional custom
        // pricing a BYOK entry can supply — computed server-side from
        // @mmd/protocol's built-in rates (the frontend never imports that
        // package's runtime code directly, only fetches this over HTTP,
        // same as /api/models).
        suggestedRate: suggestedRateFor(providerId),
      })),
    });
  });
}

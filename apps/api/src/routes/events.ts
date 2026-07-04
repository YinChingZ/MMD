import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { listRunEventsSince } from "../repositories/events-repo.js";
import { getRun } from "../repositories/runs-repo.js";
import { writeSseEvent } from "../sse/broadcaster.js";

export async function eventsRoutes(
  fastify: FastifyInstance,
  deps: AppDeps
): Promise<void> {
  fastify.get<{ Params: { id: string } }>(
    "/api/runs/:id/events",
    async (request, reply) => {
      const run = await getRun(deps.db, request.params.id);
      if (!run) {
        return reply.code(404).send({ error: "run not found" });
      }

      const lastEventIdHeader = request.headers["last-event-id"];
      const afterSeq =
        Number(
          Array.isArray(lastEventIdHeader)
            ? lastEventIdHeader[0]
            : lastEventIdHeader
        ) || 0;

      // Take over the raw response — SSE is a long-lived stream fastify's
      // normal request/reply lifecycle doesn't model.
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const backlog = await listRunEventsSince(
        deps.db,
        request.params.id,
        afterSeq
      );
      for (const event of backlog) {
        writeSseEvent(reply.raw, event);
      }

      if (run.status !== "running") {
        // Run already reached a terminal state before this backlog replay —
        // nothing more will ever arrive, so end the stream now instead of
        // leaving the client waiting on an open connection.
        reply.raw.end();
        return;
      }

      const unsubscribe = deps.broadcaster.subscribe(
        request.params.id,
        reply.raw
      );
      request.raw.on("close", unsubscribe);
    }
  );
}

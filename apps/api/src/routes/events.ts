import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { resolveWorkspace } from "../middleware/workspace.js";
import { listRunEventsSince } from "../repositories/events-repo.js";
import { getRun } from "../repositories/runs-repo.js";
import { writeSseEvent } from "../sse/broadcaster.js";

export async function eventsRoutes(
  fastify: FastifyInstance,
  deps: AppDeps
): Promise<void> {
  fastify.addHook("onRequest", async (request, reply) => {
    request.workspaceId = await resolveWorkspace(deps.db, request, reply);
  });

  fastify.get<{ Params: { id: string } }>(
    "/api/runs/:id/events",
    async (request, reply) => {
      const run = await getRun(deps.db, request.params.id);
      if (!run || run.workspaceId !== request.workspaceId) {
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
      // normal request/reply lifecycle doesn't model. Merge in any headers
      // Fastify already queued (e.g. a Set-Cookie from resolveWorkspace
      // issuing a fresh workspace) since writeHead bypasses its own pipeline.
      reply.hijack();
      reply.raw.writeHead(200, {
        ...(reply.getHeaders() as Record<string, string>),
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

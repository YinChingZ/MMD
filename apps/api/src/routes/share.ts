import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { getRunByShareToken } from "../repositories/runs-repo.js";
import { getResult } from "../repositories/results-repo.js";

/**
 * Deliberately its own file, separate from routes/runs.ts: every other run
 * route requires a workspace (via the onRequest hook those files register),
 * this one is the one deliberate exception — no resolveWorkspace call, no
 * cookie read or set, so an anonymous/incognito visitor with a share link
 * never touches workspace state at all. A run only ever has a share_token
 * once a workspace owner explicitly opts in via POST /api/runs/:id/share
 * (see routes/runs.ts), and only while completed — see runs-repo.ts.
 */
export async function shareRoutes(
  fastify: FastifyInstance,
  deps: AppDeps
): Promise<void> {
  fastify.get<{ Params: { token: string } }>(
    "/api/share/:token",
    async (request, reply) => {
      const run = await getRunByShareToken(deps.db, request.params.token);
      if (!run) {
        return reply.code(404).send({ error: "share link not found" });
      }
      const result = await getResult(deps.db, run.id);
      if (!result) {
        return reply.code(404).send({ error: "result not found" });
      }
      return reply.send({
        runId: run.id,
        question: run.question,
        mode: run.mode,
        governance: run.governance,
        status: run.status,
        ...result,
      });
    }
  );
}

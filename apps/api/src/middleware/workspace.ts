import type { FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import type { Database } from "../db/client.js";
import {
  createWorkspace,
  getWorkspaceByToken,
  touchLastSeen,
} from "../repositories/workspaces-repo.js";

declare module "fastify" {
  interface FastifyRequest {
    workspaceId: string;
  }
}

export const WORKSPACE_COOKIE_NAME = "mmd_workspace";
const WORKSPACE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * No login/accounts (see docs/roadmap.md's BYOK
 * section) — instead every visitor gets an opaque, unguessable workspace
 * token so conversation/run history doesn't leak across visitors the moment
 * more than one person uses a deployed instance. Carries no PII, so it's
 * issued transparently (no consent UI) the same way any stateful web app
 * issues a session cookie. A stale/tampered/unknown token is silently
 * replaced with a fresh workspace rather than treated as an error.
 */
export async function resolveWorkspace(
  db: Kysely<Database>,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string> {
  const token = request.cookies[WORKSPACE_COOKIE_NAME];
  if (token) {
    const workspace = await getWorkspaceByToken(db, token);
    if (workspace) {
      await touchLastSeen(db, workspace.id);
      return workspace.id;
    }
  }

  const workspace = await createWorkspace(db);
  reply.setCookie(WORKSPACE_COOKIE_NAME, workspace.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: WORKSPACE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return workspace.id;
}

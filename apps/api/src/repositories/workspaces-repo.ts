import { randomBytes } from "node:crypto";
import type { Kysely, Selectable } from "kysely";
import type { Database, WorkspacesTable } from "../db/client.js";

export interface WorkspaceRow {
  id: string;
  token: string;
  createdAt: string;
  lastSeenAt: string;
}

export async function createWorkspace(
  db: Kysely<Database>
): Promise<WorkspaceRow> {
  const token = randomBytes(32).toString("hex");
  const row = await db
    .insertInto("workspaces")
    .values({ token })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toWorkspaceRow(row);
}

export async function getWorkspaceByToken(
  db: Kysely<Database>,
  token: string
): Promise<WorkspaceRow | undefined> {
  const row = await db
    .selectFrom("workspaces")
    .selectAll()
    .where("token", "=", token)
    .executeTakeFirst();
  return row ? toWorkspaceRow(row) : undefined;
}

export async function touchLastSeen(
  db: Kysely<Database>,
  id: string
): Promise<void> {
  await db
    .updateTable("workspaces")
    .set({ last_seen_at: new Date() })
    .where("id", "=", id)
    .execute();
}

function toWorkspaceRow(row: Selectable<WorkspacesTable>): WorkspaceRow {
  return {
    id: row.id,
    token: row.token,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}

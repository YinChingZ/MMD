import type { Kysely, Selectable } from "kysely";
import type { ConversationsTable, Database } from "../db/client.js";

export interface ConversationSummary {
  id: string;
  title: string | null;
  workspaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function createConversation(
  db: Kysely<Database>,
  workspaceId: string,
  title?: string
): Promise<ConversationSummary> {
  const row = await db
    .insertInto("conversations")
    .values({ title: title ?? null, workspace_id: workspaceId })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toSummary(row);
}

export async function getConversation(
  db: Kysely<Database>,
  id: string
): Promise<ConversationSummary | undefined> {
  const row = await db
    .selectFrom("conversations")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? toSummary(row) : undefined;
}

/**
 * Relies on the M5.3 `ON DELETE CASCADE` migration (0006) to remove every
 * dependent row (runs, and each run's claims/reviews/candidates/votes/
 * run_results/run_events) — no manual dependency-ordered deletes here.
 */
export async function deleteConversation(
  db: Kysely<Database>,
  id: string
): Promise<void> {
  await db.deleteFrom("conversations").where("id", "=", id).execute();
}

export async function listConversations(
  db: Kysely<Database>,
  workspaceId: string
): Promise<ConversationSummary[]> {
  const rows = await db
    .selectFrom("conversations")
    .selectAll()
    .where("workspace_id", "=", workspaceId)
    .orderBy("updated_at", "desc")
    .execute();
  return rows.map(toSummary);
}

function toSummary(
  row: Selectable<ConversationsTable>
): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    workspaceId: row.workspace_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

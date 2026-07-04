import type { Kysely, Selectable } from "kysely";
import type { ModelConfig } from "@mmd/model-adapters";
import type { RunBudget, RunMode } from "@mmd/protocol";
import type { Database, RunsTable } from "../db/client.js";

export type RunStatus = "running" | "completed" | "failed";

export interface RunRow {
  id: string;
  conversationId: string;
  workspaceId: string | null;
  question: string;
  mode: RunMode;
  status: RunStatus;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export async function createRun(
  db: Kysely<Database>,
  params: {
    id: string;
    conversationId: string;
    workspaceId: string;
    question: string;
    mode: RunMode;
    modelConfig: ModelConfig[];
    budget: RunBudget;
  }
): Promise<RunRow> {
  const row = await db
    .insertInto("runs")
    .values({
      id: params.id,
      conversation_id: params.conversationId,
      workspace_id: params.workspaceId,
      question: params.question,
      mode: params.mode,
      status: "running",
      model_config: JSON.stringify(params.modelConfig),
      budget: JSON.stringify(params.budget),
      error: null,
      completed_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toRunRow(row);
}

export async function markRunCompleted(
  db: Kysely<Database>,
  runId: string
): Promise<void> {
  await db
    .updateTable("runs")
    .set({ status: "completed", completed_at: new Date() })
    .where("id", "=", runId)
    .execute();
}

export async function markRunFailed(
  db: Kysely<Database>,
  runId: string,
  error: string
): Promise<void> {
  await db
    .updateTable("runs")
    .set({ status: "failed", error, completed_at: new Date() })
    .where("id", "=", runId)
    .execute();
}

export async function getRun(
  db: Kysely<Database>,
  runId: string
): Promise<RunRow | undefined> {
  const row = await db
    .selectFrom("runs")
    .selectAll()
    .where("id", "=", runId)
    .executeTakeFirst();
  return row ? toRunRow(row) : undefined;
}

export async function listRunsForConversation(
  db: Kysely<Database>,
  conversationId: string
): Promise<RunRow[]> {
  const rows = await db
    .selectFrom("runs")
    .selectAll()
    .where("conversation_id", "=", conversationId)
    .orderBy("created_at", "asc")
    .execute();
  return rows.map(toRunRow);
}

function toRunRow(row: Selectable<RunsTable>): RunRow {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    workspaceId: row.workspace_id,
    question: row.question,
    mode: row.mode as RunMode,
    status: row.status as RunStatus,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

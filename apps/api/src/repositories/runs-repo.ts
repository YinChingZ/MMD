import { randomBytes } from "node:crypto";
import type { Kysely, Selectable } from "kysely";
import type { ModelConfig } from "@mmd/model-adapters";
import type { Governance, RunBudget, RunMode } from "@mmd/protocol";
import type { Database, RunsTable } from "../db/client.js";

export interface InputImage {
  dataUrl: string;
}

export type RunStatus = "running" | "completed" | "failed";

export interface RunRow {
  id: string;
  conversationId: string;
  workspaceId: string | null;
  question: string;
  mode: RunMode;
  governance: Governance;
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
    images?: InputImage[];
    mode: RunMode;
    governance?: Governance;
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
      input_images: JSON.stringify(params.images ?? []),
      mode: params.mode,
      governance: params.governance ?? "centralized",
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

/**
 * Deliberately NOT part of getRun/RunRow — getRun backs useRunStatus.ts's 5s
 * poll while a run is "running", and RunRow's Selectable<RunsTable> already
 * pulls input_images off the wire via .selectAll() there. Mapping images
 * into the polled response would repeatedly re-transfer the full base64
 * payload to the browser for the run's whole duration. This is a separate,
 * minimal-column, call-once query for M6.5's "let the owner view their
 * attached images after the fact" — see 0009_input_images.sql's comment for
 * the rest of the retention policy this still respects (never in GET
 * /result, SSE, or the public share endpoint).
 */
export async function getRunImages(
  db: Kysely<Database>,
  runId: string
): Promise<{ workspaceId: string | null; images: InputImage[] } | undefined> {
  const row = await db
    .selectFrom("runs")
    .select(["workspace_id", "input_images"])
    .where("id", "=", runId)
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    workspaceId: row.workspace_id,
    images: (row.input_images as InputImage[] | null) ?? [],
  };
}

/**
 * The most recently created completed run in a conversation, if any — used
 * by RunService.start() to give the next run in the same conversation a
 * one-turn memory of what was already asked/answered (M6.7). Deliberately
 * just the immediately-previous turn, not the full conversation history —
 * see docs/roadmap.md's M6.7 note on token-budget scope.
 */
export async function getLatestCompletedRun(
  db: Kysely<Database>,
  conversationId: string
): Promise<{ id: string; question: string } | undefined> {
  return db
    .selectFrom("runs")
    .select(["id", "question"])
    .where("conversation_id", "=", conversationId)
    .where("status", "=", "completed")
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
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

/**
 * Idempotent: returns the existing token if this run was already shared,
 * rather than minting (and orphaning) a new one on every click of "Share".
 * Same token format/length as workspaces-repo.ts's session token — 256 bits
 * makes guessing infeasible, so unlike M5.3's rate-limited endpoints this
 * doesn't need its own throttling.
 */
export async function getOrCreateShareToken(
  db: Kysely<Database>,
  runId: string
): Promise<string> {
  const existing = await db
    .selectFrom("runs")
    .select("share_token")
    .where("id", "=", runId)
    .executeTakeFirst();
  if (existing?.share_token) return existing.share_token;

  const token = randomBytes(32).toString("hex");
  await db
    .updateTable("runs")
    .set({ share_token: token })
    .where("id", "=", runId)
    .execute();
  return token;
}

export async function revokeShareToken(
  db: Kysely<Database>,
  runId: string
): Promise<void> {
  await db
    .updateTable("runs")
    .set({ share_token: null })
    .where("id", "=", runId)
    .execute();
}

/**
 * The public, cookie-free lookup path (see routes/share.ts) — deliberately
 * separate from getRun so nothing here ever accidentally exposes
 * workspaceId/share_token itself to an anonymous caller.
 */
export async function getRunByShareToken(
  db: Kysely<Database>,
  token: string
): Promise<RunRow | undefined> {
  const row = await db
    .selectFrom("runs")
    .selectAll()
    .where("share_token", "=", token)
    .executeTakeFirst();
  return row ? toRunRow(row) : undefined;
}

function toRunRow(row: Selectable<RunsTable>): RunRow {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    workspaceId: row.workspace_id,
    question: row.question,
    mode: row.mode as RunMode,
    governance: row.governance as Governance,
    status: row.status as RunStatus,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

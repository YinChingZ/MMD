import type { Kysely, Selectable } from "kysely";
import type { RunEvent } from "@mmd/orchestrator";
import type { Database, RunEventsTable } from "../db/client.js";

export interface PersistedRunEvent {
  seq: number;
  type: string;
  phase: string | null;
  topicId: string | null;
  data: unknown;
  createdAt: string;
}

function extractTopicId(data: unknown): string | null {
  if (data && typeof data === "object" && "topicId" in data) {
    const topicId = (data as Record<string, unknown>).topicId;
    return typeof topicId === "string" ? topicId : null;
  }
  return null;
}

/**
 * Sequence numbers are assigned by the caller (run-service keeps an
 * in-memory per-run counter — single process, one writer per run) rather
 * than derived from a DB round trip per event.
 */
export async function appendRunEvent(
  db: Kysely<Database>,
  params: { runId: string; seq: number; event: RunEvent }
): Promise<PersistedRunEvent> {
  const { runId, seq, event } = params;
  const row = await db
    .insertInto("run_events")
    .values({
      run_id: runId,
      seq,
      type: event.type,
      phase: event.phase ?? null,
      topic_id: extractTopicId(event.data),
      data: JSON.stringify(event.data ?? {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toPersistedEvent(row);
}

export async function listRunEventsSince(
  db: Kysely<Database>,
  runId: string,
  afterSeq: number
): Promise<PersistedRunEvent[]> {
  const rows = await db
    .selectFrom("run_events")
    .selectAll()
    .where("run_id", "=", runId)
    .where("seq", ">", afterSeq)
    .orderBy("seq", "asc")
    .execute();
  return rows.map(toPersistedEvent);
}

function toPersistedEvent(
  row: Selectable<RunEventsTable>
): PersistedRunEvent {
  return {
    seq: row.seq,
    type: row.type,
    phase: row.phase,
    topicId: row.topic_id,
    data: row.data,
    createdAt: row.created_at.toISOString(),
  };
}

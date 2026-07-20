import type { Kysely } from "kysely";
import { MmdTraceV3Schema, type MmdTraceV3 } from "@mmd/protocol";
import type { Database } from "../db/client.js";

export async function saveTraceSnapshot(
  db: Kysely<Database>,
  trace: MmdTraceV3
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("run_traces")
      .values({
        run_id: trace.run_id,
        status: trace.status,
        trace: JSON.stringify(trace),
      })
      .onConflict((conflict) =>
        conflict.column("run_id").doUpdateSet({
          status: trace.status,
          trace: JSON.stringify(trace),
          updated_at: new Date(),
        })
      )
      .execute();

    for (const artifact of trace.artifacts) {
      await trx
        .insertInto("run_artifacts")
        .values({
          run_id: trace.run_id,
          artifact_id: artifact.artifact_id,
          kind: artifact.kind,
          phase: artifact.phase,
          status: artifact.status,
          topic_id: artifact.topic_id ?? null,
          candidate_set_id: artifact.candidate_set_id ?? null,
          parent_ids: JSON.stringify(artifact.parent_ids),
          payload: JSON.stringify(artifact.payload),
        })
        .onConflict((conflict) =>
          conflict.columns(["run_id", "artifact_id"]).doUpdateSet({
            status: artifact.status,
            parent_ids: JSON.stringify(artifact.parent_ids),
            payload: JSON.stringify(artifact.payload),
            updated_at: new Date(),
          })
        )
        .execute();
    }
  });
}

export async function getTraceSnapshot(
  db: Kysely<Database>,
  runId: string
): Promise<MmdTraceV3 | undefined> {
  const row = await db
    .selectFrom("run_traces")
    .select("trace")
    .where("run_id", "=", runId)
    .executeTakeFirst();
  if (!row) return undefined;
  const parsed = MmdTraceV3Schema.safeParse(row.trace);
  return parsed.success ? parsed.data : undefined;
}

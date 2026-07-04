import type { Kysely } from "kysely";
import type {
  ClassifyCandidateResult,
  Critique,
  NormalizeResult,
  Proposal,
  VoteSet,
} from "@mmd/protocol";
import type { DeliberationResult } from "@mmd/orchestrator";
import type { Database } from "../db/client.js";

interface ClaimRow {
  run_id: string;
  claim_id: string;
  model_id: string;
  topic_id: string | null;
  text: string;
  claim_type: string;
  confidence: number;
  rationale: string;
  payload: string;
}

interface ReviewRow {
  run_id: string;
  reviewer_model_id: string;
  target_claim_id: string;
  topic_id: string | null;
  stance: string;
  severity: string;
  comment: string;
  suggested_revision: string | null;
  payload: string;
}

interface CandidateRow {
  run_id: string;
  candidate_id: string;
  topic_id: string | null;
  text: string;
  source_claim_ids: string[];
  notes: string | null;
  classification: string;
  payload: string;
}

interface VoteRow {
  run_id: string;
  candidate_id: string;
  model_id: string;
  vote: string;
  confidence: number;
  reason: string;
  objection_severity: string | null;
  payload: string;
}

/**
 * Appends flattened rows for one "bucket" (either the whole standard/quick
 * mode result, or a single planning-mode topic) into the accumulators.
 *
 * `candidate_id` is LLM-self-assigned during Normalize/Vote and is NOT
 * guaranteed unique across topics — unlike `claim_id`, which the
 * orchestrator itself scopes per-topic via stampProposal (`${topicId}::
 * ${modelId}::c${i}`), candidate ids are never stamped and real models
 * (and MockProvider — every topic's mockNormalize deterministically emits
 * "cc_1", "cc_2", ...) reuse the same short ids like "cc_1" in every topic.
 * Flattening planning mode's topics into the shared `candidates`/`votes`
 * tables without scoping by topic here caused real, reproducible primary-key
 * collisions (`duplicate key value violates unique constraint
 * "candidates_pkey"`) the first time a real cross-topic planning run was
 * persisted — this file's `db.transaction()` means the whole run's data was
 * lost when that happened, not just the candidates rows. Scoping the DB-only
 * candidate_id as `${topicId}::${candidateId}` (topic_id here is always the
 * ground-truth Topic.topic_id, never LLM-invented) fixes it; the JSON blob
 * in `run_results` is unaffected and still stores the orchestrator's
 * original, unscoped ids exactly as produced.
 */
function addBucket(
  accum: {
    claims: ClaimRow[];
    reviews: ReviewRow[];
    candidates: CandidateRow[];
    votes: VoteRow[];
  },
  runId: string,
  bucket: {
    proposals: Proposal[];
    critiques: Critique[];
    normalize: NormalizeResult;
    votes: VoteSet[];
    classifications: Record<string, ClassifyCandidateResult>;
  },
  topicId: string | null
): void {
  const scopeCandidateId = (id: string) =>
    topicId ? `${topicId}::${id}` : id;

  for (const p of bucket.proposals) {
    for (const c of p.claims) {
      accum.claims.push({
        run_id: runId,
        claim_id: c.claim_id,
        model_id: p.model_id,
        topic_id: c.topic_id ?? null,
        text: c.text,
        claim_type: c.type,
        confidence: c.confidence,
        rationale: c.rationale,
        payload: JSON.stringify(c),
      });
    }
  }

  for (const c of bucket.critiques) {
    for (const r of c.reviews) {
      accum.reviews.push({
        run_id: runId,
        reviewer_model_id: c.reviewer_model_id,
        target_claim_id: r.target_claim_id,
        topic_id: topicId,
        stance: r.stance,
        severity: r.severity,
        comment: r.comment,
        suggested_revision: r.suggested_revision ?? null,
        payload: JSON.stringify(r),
      });
    }
  }

  for (const cand of bucket.normalize.candidate_claims) {
    accum.candidates.push({
      run_id: runId,
      candidate_id: scopeCandidateId(cand.candidate_id),
      topic_id: topicId ?? cand.topic_id ?? null,
      text: cand.text,
      source_claim_ids: cand.source_claim_ids,
      notes: cand.notes ?? null,
      classification: JSON.stringify(
        bucket.classifications[cand.candidate_id] ?? null
      ),
      payload: JSON.stringify(cand),
    });
  }

  for (const v of bucket.votes) {
    for (const ballot of v.votes) {
      accum.votes.push({
        run_id: runId,
        candidate_id: scopeCandidateId(ballot.candidate_id),
        model_id: v.model_id,
        vote: ballot.vote,
        confidence: ballot.confidence,
        reason: ballot.reason,
        objection_severity: ballot.objection_severity ?? null,
        payload: JSON.stringify(ballot),
      });
    }
  }
}

/**
 * Persists the full DeliberationResult as the source of truth for
 * GET /api/runs/:id/result, plus a flattened projection into
 * claims/reviews/candidates/votes for future per-claim querying (M0's
 * traceability requirement extended into persistence, not just the JSON
 * blob).
 */
export async function saveResult(
  db: Kysely<Database>,
  result: DeliberationResult
): Promise<void> {
  const accum = {
    claims: [] as ClaimRow[],
    reviews: [] as ReviewRow[],
    candidates: [] as CandidateRow[],
    votes: [] as VoteRow[],
  };

  if (result.topics?.length) {
    for (const topicResult of result.topics) {
      addBucket(
        accum,
        result.runId,
        {
          proposals: topicResult.proposals,
          critiques: topicResult.critiques,
          normalize: topicResult.normalize,
          votes: topicResult.votes,
          classifications: topicResult.classifications,
        },
        topicResult.topic.topic_id
      );
    }
  } else {
    addBucket(
      accum,
      result.runId,
      {
        proposals: result.proposals,
        critiques: result.critiques,
        normalize: result.normalize,
        votes: result.votes,
        classifications: result.classifications,
      },
      null
    );
  }

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("run_results")
      .values({
        run_id: result.runId,
        proposals: JSON.stringify(result.proposals),
        critiques: JSON.stringify(result.critiques),
        revisions: JSON.stringify(result.revisions),
        normalize: JSON.stringify(result.normalize),
        votes: JSON.stringify(result.votes),
        classifications: JSON.stringify(result.classifications),
        final_answer: JSON.stringify(result.final),
        outline: result.outline ? JSON.stringify(result.outline) : null,
        topics: result.topics ? JSON.stringify(result.topics) : null,
        plan_document: result.planDocument
          ? JSON.stringify(result.planDocument)
          : null,
        timings: JSON.stringify(result.timings),
        quorum: JSON.stringify(result.quorum),
      })
      .execute();

    if (accum.claims.length) {
      await trx.insertInto("claims").values(accum.claims).execute();
    }
    if (accum.reviews.length) {
      await trx.insertInto("reviews").values(accum.reviews).execute();
    }
    if (accum.candidates.length) {
      await trx.insertInto("candidates").values(accum.candidates).execute();
    }
    if (accum.votes.length) {
      await trx.insertInto("votes").values(accum.votes).execute();
    }
  });
}

export async function getResult(
  db: Kysely<Database>,
  runId: string
): Promise<Record<string, unknown> | undefined> {
  const row = await db
    .selectFrom("run_results")
    .selectAll()
    .where("run_id", "=", runId)
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    proposals: row.proposals,
    critiques: row.critiques,
    revisions: row.revisions,
    normalize: row.normalize,
    votes: row.votes,
    classifications: row.classifications,
    final: row.final_answer,
    outline: row.outline ?? undefined,
    topics: row.topics ?? undefined,
    planDocument: row.plan_document ?? undefined,
    timings: row.timings,
    quorum: row.quorum,
  };
}

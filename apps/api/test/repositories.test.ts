import { MockProvider } from "@mmd/model-adapters";
import { runDeliberation } from "@mmd/orchestrator";
import { getBudget } from "@mmd/protocol";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/client.js";
import { appendRunEvent, listRunEventsSince } from "../src/repositories/events-repo.js";
import { createConversation, getConversation } from "../src/repositories/conversations-repo.js";
import { getResult, saveResult } from "../src/repositories/results-repo.js";
import {
  createRun,
  getRun,
  listRunsForConversation,
  markRunCompleted,
  markRunFailed,
} from "../src/repositories/runs-repo.js";
import { createWorkspace } from "../src/repositories/workspaces-repo.js";
import { hasTestDatabase, setupTestDb, truncateAll } from "./db-helpers.js";

const describeIfDb = hasTestDatabase() ? describe : describe.skip;
if (!hasTestDatabase()) {
  console.log(
    "apps/api/test/repositories.test.ts: DATABASE_URL not set — skipping (see docker-compose.yml + apps/api/.env.example)."
  );
}

describeIfDb("apps/api repositories (integration, requires DATABASE_URL)", () => {
  let db: Kysely<Database>;
  let workspaceId: string;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    workspaceId = (await createWorkspace(db)).id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("creates and reads a conversation", async () => {
    const conversation = await createConversation(
      db,
      workspaceId,
      "Test conversation"
    );
    expect(conversation.title).toBe("Test conversation");
    expect(conversation.workspaceId).toBe(workspaceId);
    const fetched = await getConversation(db, conversation.id);
    expect(fetched?.id).toBe(conversation.id);
  });

  it("creates a run, transitions it to completed, and lists it under its conversation", async () => {
    const conversation = await createConversation(db, workspaceId);
    const run = await createRun(db, {
      id: "run_test_1",
      conversationId: conversation.id,
      workspaceId,
      question: "Q?",
      mode: "standard",
      modelConfig: [{ id: "model_a", provider: "mock" }],
      budget: getBudget("standard"),
    });
    expect(run.status).toBe("running");
    expect(run.workspaceId).toBe(workspaceId);

    await markRunCompleted(db, run.id);
    const updated = await getRun(db, run.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.completedAt).not.toBeNull();

    const runs = await listRunsForConversation(db, conversation.id);
    expect(runs.map((r) => r.id)).toEqual([run.id]);
  });

  it("marks a run failed with an error message", async () => {
    const conversation = await createConversation(db, workspaceId);
    const run = await createRun(db, {
      id: "run_test_fail",
      conversationId: conversation.id,
      workspaceId,
      question: "Q?",
      mode: "standard",
      modelConfig: [{ id: "model_a", provider: "mock" }],
      budget: getBudget("standard"),
    });
    await markRunFailed(db, run.id, "boom");
    const updated = await getRun(db, run.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe("boom");
  });

  it("appends run events with caller-assigned seq and replays only events after a given seq", async () => {
    const conversation = await createConversation(db, workspaceId);
    const run = await createRun(db, {
      id: "run_test_events",
      conversationId: conversation.id,
      workspaceId,
      question: "Q?",
      mode: "standard",
      modelConfig: [{ id: "model_a", provider: "mock" }],
      budget: getBudget("standard"),
    });

    await appendRunEvent(db, {
      runId: run.id,
      seq: 1,
      event: {
        type: "run_started",
        runId: run.id,
        timestamp: new Date().toISOString(),
      },
    });
    await appendRunEvent(db, {
      runId: run.id,
      seq: 2,
      event: {
        type: "phase_started",
        phase: "propose",
        runId: run.id,
        timestamp: new Date().toISOString(),
      },
    });

    const all = await listRunEventsSince(db, run.id, 0);
    expect(all.map((e) => e.seq)).toEqual([1, 2]);

    const sinceOne = await listRunEventsSince(db, run.id, 1);
    expect(sinceOne.map((e) => e.type)).toEqual(["phase_started"]);
  });

  it("persists a full deliberation result and reconstructs it via getResult, preserving candidate source_claim_ids traceability", async () => {
    const conversation = await createConversation(db, workspaceId);
    const models = [
      { id: "model_a", provider: "mock" },
      { id: "model_b", provider: "mock" },
      { id: "model_c", provider: "mock" },
    ];
    const result = await runDeliberation({
      question: "Should a small team adopt a monorepo?",
      models,
      provider: new MockProvider(),
      runId: "run_test_result",
    });

    await createRun(db, {
      id: result.runId,
      conversationId: conversation.id,
      workspaceId,
      question: result.question,
      mode: result.mode,
      modelConfig: models,
      budget: result.budget,
    });
    await saveResult(db, result);

    const stored = await getResult(db, result.runId);
    expect(stored).toBeDefined();
    const finalAnswer = stored?.final as { final_answer: string };
    expect(finalAnswer.final_answer).toBe(result.final.final_answer);

    const normalize = stored?.normalize as {
      candidate_claims: { source_claim_ids: string[] }[];
    };
    expect(normalize.candidate_claims.length).toBe(
      result.normalize.candidate_claims.length
    );
    for (const candidate of normalize.candidate_claims) {
      expect(candidate.source_claim_ids.length).toBeGreaterThan(0);
    }
  });

  it("persists a planning-mode result without candidate/vote primary-key collisions across topics (regression: MockProvider's mockNormalize deterministically emits cc_1/cc_2/... in every topic, and a real cross-topic planning run hit 'duplicate key value violates unique constraint candidates_pkey' before candidate/vote ids were scoped per topic)", async () => {
    const conversation = await createConversation(db, workspaceId);
    const models = [
      { id: "model_a", provider: "mock" },
      { id: "model_b", provider: "mock" },
      { id: "model_c", provider: "mock" },
    ];
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider(),
      mode: "planning",
      runId: "run_test_planning_result",
    });
    expect(result.topics?.length).toBeGreaterThan(1);

    await createRun(db, {
      id: result.runId,
      conversationId: conversation.id,
      workspaceId,
      question: result.question,
      mode: result.mode,
      modelConfig: models,
      budget: result.budget,
    });

    // Would throw "duplicate key value violates unique constraint
    // candidates_pkey" before the topic-scoping fix.
    await saveResult(db, result);

    const candidateRows = await db
      .selectFrom("candidates")
      .selectAll()
      .where("run_id", "=", result.runId)
      .execute();
    const totalCandidatesAcrossTopics = (result.topics ?? []).reduce(
      (sum, t) => sum + t.normalize.candidate_claims.length,
      0
    );
    // One DB row per (topic, candidate) pair — proves no rows were silently
    // dropped/overwritten by the id collision.
    expect(candidateRows.length).toBe(totalCandidatesAcrossTopics);

    // Each row's persisted classification must match its OWN topic's
    // classification, not another topic's (the bug this regresses against
    // would have let Object.assign-style merging silently pick the wrong
    // topic's classification for a colliding "cc_1"-style id).
    for (const topicResult of result.topics ?? []) {
      for (const candidate of topicResult.normalize.candidate_claims) {
        const row = candidateRows.find(
          (r) => r.candidate_id === `${topicResult.topic.topic_id}::${candidate.candidate_id}`
        );
        expect(row).toBeDefined();
        expect(row?.classification).toEqual(
          topicResult.classifications[candidate.candidate_id]
        );
      }
    }

    const voteRows = await db
      .selectFrom("votes")
      .selectAll()
      .where("run_id", "=", result.runId)
      .execute();
    const totalVotesAcrossTopics = (result.topics ?? []).reduce(
      (sum, t) => sum + t.votes.reduce((s, v) => s + v.votes.length, 0),
      0
    );
    expect(voteRows.length).toBe(totalVotesAcrossTopics);
  });
});

import { describe, expect, it } from "vitest";
import { FinalAnswerSchema, SectionAnswerSchema } from "@mmd/protocol";
import { MockProvider } from "@mmd/model-adapters";
import { DeliberationQuorumError, runDeliberation } from "../src/index.js";

const models = [
  { id: "model_a", provider: "mock" },
  { id: "model_b", provider: "mock" },
  { id: "model_c", provider: "mock" },
];
const question = "Should a small team adopt a monorepo?";

describe("runDeliberation — M1 acceptance criteria", () => {
  it("runs the full standard pipeline end-to-end and produces a schema-valid final answer", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
    });

    expect(FinalAnswerSchema.safeParse(result.final).success).toBe(true);
    expect(result.proposals).toHaveLength(3);
    expect(result.critiques).toHaveLength(3);
    expect(result.revisions).toHaveLength(3);
    expect(result.votes).toHaveLength(3);
    expect(Object.keys(result.timings)).toEqual([
      "propose",
      "critique",
      "revise",
      "normalize",
      "vote",
      "compose",
    ]);
  });

  it("uses a caller-supplied runId instead of generating one, so API callers can know the id before the run settles", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
      runId: "run_caller_supplied",
    });

    expect(result.runId).toBe("run_caller_supplied");
  });

  it("surfaces which models changed their position and why (not just a flat merge)", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
    });

    // Deterministic given MockProvider's hash-based critique stances for these
    // exact model ids and the orchestrator's own "${modelId}::c${i}" claim id
    // scoping: only model_a's first claim draws a (major) challenge from
    // model_c; every other claim is only ever supported.
    expect(result.final.model_position_changes).toHaveLength(1);
    const changedModels = new Set(
      result.final.model_position_changes.map((c) => c.model_id)
    );
    expect(changedModels).toEqual(new Set(["model_a"]));
    for (const change of result.final.model_position_changes) {
      expect(change.changed_from).not.toBe(change.changed_to);
      expect(change.reason.length).toBeGreaterThan(0);
    }
  });

  it("classifies candidates into consensus buckets using traceable candidates", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
    });

    expect(Object.keys(result.classifications)).toEqual(
      result.normalize.candidate_claims.map((c) => c.candidate_id)
    );
    for (const candidate of result.normalize.candidate_claims) {
      expect(candidate.source_claim_ids.length).toBeGreaterThan(0);
    }
    const validLabels = new Set([
      "strong_consensus",
      "qualified_consensus",
      "disputed",
      "rejected",
    ]);
    for (const { label } of Object.values(result.classifications)) {
      expect(validLabels.has(label)).toBe(true);
    }
  });

  it("degrades gracefully when one model fails: quorum met, run completes, marked partial", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider({ failModelIds: new Set(["model_c"]) }),
    });

    expect(result.proposals).toHaveLength(2);
    expect(result.quorum.propose?.met).toBe(true);
    expect(result.quorum.propose?.partial).toBe(true);
    expect(FinalAnswerSchema.safeParse(result.final).success).toBe(true);
  });

  it("fails fast with a typed error when quorum is not met (2 of 3 models down), naming which models failed and why", async () => {
    const run = runDeliberation({
      question,
      models,
      provider: new MockProvider({
        failModelIds: new Set(["model_b", "model_c"]),
      }),
    });
    await expect(run).rejects.toThrow(DeliberationQuorumError);
    try {
      await run;
      expect.unreachable();
    } catch (err) {
      const error = err as DeliberationQuorumError;
      expect(error.phase).toBe("propose");
      expect(error.failures.map((f) => f.modelId).sort()).toEqual([
        "model_b",
        "model_c",
      ]);
      for (const f of error.failures) {
        expect(f.message).toMatch(/simulated failure/);
      }
    }
  });

  it("quick mode skips critique/revise/vote but still classifies via proposal overlap", async () => {
    const result = await runDeliberation({
      question,
      models: models.slice(0, 2),
      provider: new MockProvider(),
      mode: "quick",
    });

    expect(result.critiques).toHaveLength(0);
    expect(result.revisions).toHaveLength(0);
    expect(result.votes).toHaveLength(0);
    expect(result.normalize.candidate_claims.length).toBeGreaterThan(0);
    expect(Object.keys(result.timings)).toEqual([
      "propose",
      "normalize",
      "compose",
    ]);
    expect(FinalAnswerSchema.safeParse(result.final).success).toBe(true);
  });
});

describe("runDeliberation — v0.2 planning mode", () => {
  it("runs an outline then a full per-topic deliberation, producing a schema-valid plan document", async () => {
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider(),
      mode: "planning",
    });

    // MockProvider's mockOutline deterministically produces 2 topics (capped
    // by PLANNING_BUDGET.maxTopics=8, but MockProvider keeps it small so
    // tests stay fast and assertions can be exact).
    expect(result.outline?.topics).toHaveLength(2);
    expect(result.topics).toHaveLength(2);
    expect(result.planDocument?.sections).toHaveLength(2);

    for (const section of result.planDocument?.sections ?? []) {
      expect(SectionAnswerSchema.safeParse(section).success).toBe(true);
    }

    // executive_summary is a deterministic join of each section's tldr, never
    // a fresh model call — assert it round-trips exactly, not just "exists".
    const expectedSummary = (result.planDocument?.sections ?? [])
      .map((s) => s.tldr)
      .join("\n");
    expect(result.planDocument?.executive_summary).toBe(expectedSummary);
  });

  it("overrides a section-compose call's self-reported topic_id with ground truth (found via real-model testing: real models invent their own topic_id instead of echoing the one given)", async () => {
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider(),
      mode: "planning",
    });

    // MockProvider deliberately mangles topic_id in its section_compose
    // response (prefixes with "mock-renamed-") to mimic what real models do.
    // If the orchestrator didn't stamp it back, every section's topic_id
    // would fail to match any TopicResult and format.ts's per-section
    // timings/quorum lookup would silently render nothing.
    const topicIds = (result.topics ?? []).map((t) => t.topic.topic_id);
    const sectionTopicIds = (result.planDocument?.sections ?? []).map(
      (s) => s.topic_id
    );
    expect(sectionTopicIds).toEqual(topicIds);
    for (const id of sectionTopicIds) {
      expect(id.startsWith("mock-renamed-")).toBe(false);
    }
  });

  it("scopes each topic's proposals with model_id and claim ids in the ${topicId}::${modelId}::c{i} format", async () => {
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider(),
      mode: "planning",
    });

    for (const topicResult of result.topics ?? []) {
      for (const proposal of topicResult.proposals) {
        expect(models.map((m) => m.id)).toContain(proposal.model_id);
        for (const claim of proposal.claims) {
          expect(claim.topic_id).toBe(topicResult.topic.topic_id);
          expect(claim.claim_id.startsWith(`${topicResult.topic.topic_id}::`)).toBe(
            true
          );
        }
      }
    }

    // Claim ids from different topics never collide, even though MockProvider
    // assigns the same local claim numbering ("c0", "c1", ...) in every topic.
    const allClaimIds = (result.topics ?? []).flatMap((t) =>
      t.proposals.flatMap((p) => p.claims.map((c) => c.claim_id))
    );
    expect(new Set(allClaimIds).size).toBe(allClaimIds.length);
  });

  it("runs each topic's full six-phase deliberation (critique/revise/vote all present)", async () => {
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider(),
      mode: "planning",
    });

    for (const topicResult of result.topics ?? []) {
      expect(topicResult.critiques).toHaveLength(3);
      expect(topicResult.revisions).toHaveLength(3);
      expect(topicResult.votes).toHaveLength(3);
      expect(Object.keys(topicResult.timings)).toEqual([
        "propose",
        "critique",
        "revise",
        "normalize",
        "vote",
        "compose",
      ]);
    }
  });

  it("fails fast with a clear error when every topic fails quorum", async () => {
    // Every topic uses the same model roster, so a model-wide failure fails
    // every topic's propose phase identically — this exercises the
    // "all topics failed" aggregate error, distinct from a single topic
    // failing on its own (which Promise.allSettled would otherwise tolerate).
    await expect(
      runDeliberation({
        question: "Plan a project",
        models,
        provider: new MockProvider({
          failModelIds: new Set(["model_b", "model_c"]),
        }),
        mode: "planning",
      })
    ).rejects.toThrow(/all \d+ topic\(s\) failed/);
  });
});

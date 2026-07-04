import { describe, expect, it } from "vitest";
import { FinalAnswerSchema } from "@mmd/protocol";
import { MockProvider } from "@mmd/model-adapters";
import { DeliberationQuorumError, runDeliberation } from "../src/orchestrator.js";

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

  it("surfaces which models changed their position and why (not just a flat merge)", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
    });

    // Deterministic given MockProvider's hash-based critique stances for these
    // exact model ids: model_a and model_b each receive a non-"support" review
    // and revise both claims; model_c's claims are only ever supported.
    expect(result.final.model_position_changes).toHaveLength(4);
    const changedModels = new Set(
      result.final.model_position_changes.map((c) => c.model_id)
    );
    expect(changedModels).toEqual(new Set(["model_a", "model_b"]));
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

  it("fails fast with a typed error when quorum is not met (2 of 3 models down)", async () => {
    await expect(
      runDeliberation({
        question,
        models,
        provider: new MockProvider({
          failModelIds: new Set(["model_b", "model_c"]),
        }),
      })
    ).rejects.toThrow(DeliberationQuorumError);
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

import { describe, expect, it } from "vitest";
import {
  ProposalSchema,
  CritiqueSchema,
  RevisionSetSchema,
  NormalizeResultSchema,
  VoteSetSchema,
  FinalAnswerSchema,
} from "@mmd/protocol";
import { MockProvider } from "../src/providers/mock.js";
import type { ModelConfig } from "../src/provider.js";

const config: ModelConfig = { id: "model_a", provider: "mock" };

async function complete(meta: Record<string, unknown>) {
  const provider = new MockProvider();
  const { text } = await provider.complete(config, {
    systemPrompt: "",
    userPrompt: "",
    meta,
  });
  return JSON.parse(text);
}

describe("MockProvider — every phase output must validate against @mmd/protocol schemas", () => {
  it("propose", async () => {
    const json = await complete({ phase: "propose", question: "Is X true?" });
    expect(ProposalSchema.safeParse(json).success).toBe(true);
  });

  it("critique", async () => {
    const json = await complete({
      phase: "critique",
      targets: [
        { claim_id: "model_b_c1", text: "claim text", model_id: "model_b" },
      ],
    });
    expect(CritiqueSchema.safeParse(json).success).toBe(true);
  });

  it("revise", async () => {
    const json = await complete({
      phase: "revise",
      ownClaims: [{ claim_id: "model_a_c1", text: "claim text" }],
      reviews: [
        {
          reviewer_model_id: "model_b",
          target_claim_id: "model_a_c1",
          stance: "challenge",
        },
      ],
    });
    expect(RevisionSetSchema.safeParse(json).success).toBe(true);
  });

  it("normalize", async () => {
    const json = await complete({
      phase: "normalize",
      claims: [{ claim_id: "model_a_c1", text: "claim text" }],
    });
    expect(NormalizeResultSchema.safeParse(json).success).toBe(true);
  });

  it("vote", async () => {
    const json = await complete({
      phase: "vote",
      candidates: [{ candidate_id: "cc_1", text: "candidate text" }],
    });
    expect(VoteSetSchema.safeParse(json).success).toBe(true);
  });

  it("compose", async () => {
    const json = await complete({
      phase: "compose",
      question: "Is X true?",
      strongConsensus: ["X is true."],
      qualifiedConsensus: [],
      disputed: [],
      rejected: [],
      positionChanges: [],
    });
    expect(FinalAnswerSchema.safeParse(json).success).toBe(true);
  });

  it("throws for an unknown phase", async () => {
    await expect(complete({ phase: "unknown" })).rejects.toThrow(/unknown phase/);
  });

  it("failModelIds causes a simulated failure", async () => {
    const provider = new MockProvider({ failModelIds: new Set(["model_a"]) });
    await expect(
      provider.complete(config, {
        systemPrompt: "",
        userPrompt: "",
        meta: { phase: "propose", question: "q" },
      })
    ).rejects.toThrow(/simulated failure/);
  });
});

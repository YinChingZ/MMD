import { describe, expect, it } from "vitest";
import {
  ProposalSchema,
  CritiqueSchema,
  RevisionSetSchema,
  NormalizeResultSchema,
  VoteSetSchema,
  FinalAnswerSchema,
  OutlineResultSchema,
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

  it("outline", async () => {
    const json = await complete({ phase: "outline", question: "Plan a project" });
    expect(OutlineResultSchema.safeParse(json).success).toBe(true);
  });

  it("outline respects maxTopics", async () => {
    const json = await complete({
      phase: "outline",
      question: "Plan a project",
      maxTopics: 1,
    });
    expect(json.topics).toHaveLength(1);
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

  it("always reports a deterministic non-zero usage/cost, even for the default options", async () => {
    const provider = new MockProvider();
    const result = await provider.complete(config, {
      systemPrompt: "",
      userPrompt: "some prompt text",
      meta: { phase: "propose", question: "q" },
    });
    expect(result.usage).toBeDefined();
    expect(result.usage!.costUsd).toBeGreaterThan(0);
    expect(result.usage!.promptTokens).toBeGreaterThan(0);
    expect(result.usage!.completionTokens).toBeGreaterThan(0);
  });

  it("costPerCallUsd overrides the default fake cost", async () => {
    const provider = new MockProvider({ costPerCallUsd: 5 });
    const result = await provider.complete(config, {
      systemPrompt: "",
      userPrompt: "",
      meta: { phase: "propose", question: "q" },
    });
    expect(result.usage!.costUsd).toBe(5);
  });
});

describe("MockProvider — M6.3/M6.4 opt-in completeStream", () => {
  it("does not attach completeStream at all when streaming is unset (default)", () => {
    const provider = new MockProvider();
    expect(provider.completeStream).toBeUndefined();
  });

  it("does not attach completeStream when streaming is explicitly false", () => {
    const provider = new MockProvider({ streaming: false });
    expect(provider.completeStream).toBeUndefined();
  });

  it("attaches completeStream when streaming is true, and its deltas reconstruct the same text complete() returns", async () => {
    const provider = new MockProvider({ streaming: true, streamChunkSize: 5 });
    expect(provider.completeStream).toBeDefined();

    const request = {
      systemPrompt: "",
      userPrompt: "q",
      meta: { phase: "propose", question: "Is X true?" },
    };
    const nonStreamed = await provider.complete(config, request);

    let reconstructed = "";
    const streamed = await provider.completeStream!(config, request, (delta) => {
      reconstructed += delta;
    });

    expect(reconstructed).toBe(nonStreamed.text);
    expect(streamed.text).toBe(nonStreamed.text);
    expect(ProposalSchema.safeParse(JSON.parse(streamed.text)).success).toBe(true);
  });

  it("completeStream still simulates failModelIds", async () => {
    const provider = new MockProvider({
      streaming: true,
      failModelIds: new Set(["model_a"]),
    });
    await expect(
      provider.completeStream!(
        config,
        { systemPrompt: "", userPrompt: "", meta: { phase: "propose", question: "q" } },
        () => {}
      )
    ).rejects.toThrow(/simulated failure/);
  });
});

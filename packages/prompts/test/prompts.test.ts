import { describe, expect, it } from "vitest";
import {
  buildProposePrompt,
  buildCritiquePrompt,
  buildRevisePrompt,
  buildNormalizePrompt,
  buildVotePrompt,
  buildComposePrompt,
  buildOutlinePrompt,
} from "../src/index.js";

const sampleTopic = {
  topic_id: "database",
  title: "Database",
  description: "Choice of primary datastore",
};

describe("prompt builders", () => {
  it("buildProposePrompt embeds the Proposal schema and sets phase meta", () => {
    const req = buildProposePrompt({ question: "Is X true?", modelId: "model_a" });
    expect(req.systemPrompt).toMatch(/Return ONLY JSON/);
    expect(req.systemPrompt).toMatch(/claim_id/);
    expect(req.userPrompt).toContain("Is X true?");
    expect(req.meta).toEqual({
      phase: "propose",
      question: "Is X true?",
      modelId: "model_a",
    });
  });

  it("buildCritiquePrompt excludes the reviewer's own claims from targets", () => {
    const req = buildCritiquePrompt({
      question: "Is X true?",
      reviewerModelId: "model_a",
      proposals: [
        {
          model_id: "model_a",
          answer_summary: "s",
          claims: [
            {
              claim_id: "model_a_c1",
              text: "own claim",
              type: "fact",
              confidence: 0.8,
              rationale: "r",
              conditions: [],
            },
          ],
          assumptions: [],
          risks: [],
        },
        {
          model_id: "model_b",
          answer_summary: "s",
          claims: [
            {
              claim_id: "model_b_c1",
              text: "other claim",
              type: "fact",
              confidence: 0.7,
              rationale: "r",
              conditions: [],
            },
          ],
          assumptions: [],
          risks: [],
        },
      ],
    });
    const targets = req.meta.targets as Array<{ claim_id: string }>;
    expect(targets.map((t) => t.claim_id)).toEqual(["model_b_c1"]);
  });

  it("buildRevisePrompt carries forward ownClaims and review stances in meta", () => {
    const req = buildRevisePrompt({
      question: "Is X true?",
      modelId: "model_a",
      ownClaims: [
        {
          claim_id: "model_a_c1",
          text: "own claim",
          type: "fact",
          confidence: 0.8,
          rationale: "r",
          conditions: [],
        },
      ],
      reviewsOnMine: [
        {
          reviewer_model_id: "model_b",
          target_claim_id: "model_a_c1",
          stance: "challenge",
          severity: "major",
          comment: "disagree",
        },
      ],
    });
    expect(req.meta.ownClaims).toEqual([
      { claim_id: "model_a_c1", text: "own claim" },
    ]);
    expect(req.meta.reviews).toEqual([
      {
        reviewer_model_id: "model_b",
        target_claim_id: "model_a_c1",
        stance: "challenge",
      },
    ]);
  });

  it("buildNormalizePrompt embeds source_claim_ids requirement", () => {
    const req = buildNormalizePrompt({
      question: "Is X true?",
      claims: [{ claim_id: "model_a_c1", text: "claim", model_id: "model_a" }],
    });
    expect(req.systemPrompt).toMatch(/source_claim_ids/);
  });

  it("buildVotePrompt requires objection_severity for object votes", () => {
    const req = buildVotePrompt({
      question: "Is X true?",
      modelId: "model_a",
      candidates: [{ candidate_id: "cc_1", text: "candidate" }],
    });
    expect(req.systemPrompt).toMatch(/objection_severity/);
  });

  it("buildComposePrompt forbids introducing new claims or resolving disputes", () => {
    const req = buildComposePrompt({
      question: "Is X true?",
      strongConsensus: ["X is true"],
      qualifiedConsensus: [],
      disputed: ["Y is unclear"],
      rejected: [],
      positionChanges: [],
    });
    expect(req.systemPrompt).toMatch(/not a judge/);
    expect(req.userPrompt).toContain("Y is unclear");
  });
});

describe("v0.2 planning mode: optional topic param on existing builders", () => {
  it("buildProposePrompt omits topicId from meta when no topic is given (backward compatible)", () => {
    const req = buildProposePrompt({ question: "Is X true?", modelId: "model_a" });
    expect(req.meta).not.toHaveProperty("topicId");
  });

  it("buildProposePrompt adds a scope instruction and topicId when a topic is given", () => {
    const req = buildProposePrompt({
      question: "Plan a project",
      modelId: "model_a",
      topic: sampleTopic,
    });
    expect(req.systemPrompt).toMatch(/Address ONLY the following topic/);
    expect(req.systemPrompt).toContain("Database");
    expect(req.meta.topicId).toBe("database");
  });

  it("buildCritiquePrompt adds topicId to meta when a topic is given", () => {
    const req = buildCritiquePrompt({
      question: "Plan a project",
      reviewerModelId: "model_a",
      proposals: [],
      topic: sampleTopic,
    });
    expect(req.systemPrompt).toMatch(/scoped to the topic/);
    expect(req.meta.topicId).toBe("database");
  });

  it("buildNormalizePrompt adds topicId to meta when a topic is given", () => {
    const req = buildNormalizePrompt({
      question: "Plan a project",
      claims: [],
      topic: sampleTopic,
    });
    expect(req.systemPrompt).toMatch(/scoped to the topic/);
    expect(req.meta.topicId).toBe("database");
  });
});

describe("buildOutlinePrompt", () => {
  it("embeds the OutlineResult schema and the topic cap", () => {
    const req = buildOutlinePrompt({ question: "Plan a project", maxTopics: 5 });
    expect(req.systemPrompt).toMatch(/Return ONLY JSON/);
    expect(req.systemPrompt).toMatch(/at most 5 topics/);
    expect(req.meta).toEqual({
      phase: "outline",
      question: "Plan a project",
      maxTopics: 5,
    });
  });

  it("defaults maxTopics to 8", () => {
    const req = buildOutlinePrompt({ question: "Plan a project" });
    expect(req.meta.maxTopics).toBe(8);
  });
});

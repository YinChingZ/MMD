import { describe, expect, it } from "vitest";
import {
  buildProposePrompt,
  buildCritiquePrompt,
  buildRevisePrompt,
  buildNormalizePrompt,
  buildVotePrompt,
  buildComposePrompt,
} from "../src/index.js";

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

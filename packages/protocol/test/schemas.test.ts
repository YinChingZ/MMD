import { describe, expect, it } from "vitest";
import { CandidateClaimSchema } from "../src/schemas/normalize.js";
import { BallotSchema } from "../src/schemas/vote.js";
import { ProposalSchema } from "../src/schemas/propose.js";

describe("NormalizeResult schema (risk #2: normalize must stay traceable)", () => {
  it("accepts a candidate claim with source_claim_ids", () => {
    const result = CandidateClaimSchema.safeParse({
      candidate_id: "cc_1",
      text: "merged claim",
      source_claim_ids: ["a_c1", "b_c2"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a candidate claim with empty source_claim_ids", () => {
    const result = CandidateClaimSchema.safeParse({
      candidate_id: "cc_1",
      text: "merged claim",
      source_claim_ids: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("Ballot schema (M0 fix: object votes must carry severity)", () => {
  it("accepts an object vote with objection_severity", () => {
    const result = BallotSchema.safeParse({
      candidate_id: "cc_1",
      vote: "object",
      confidence: 0.9,
      reason: "not supported by evidence",
      objection_severity: "critical",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an object vote missing objection_severity", () => {
    const result = BallotSchema.safeParse({
      candidate_id: "cc_1",
      vote: "object",
      confidence: 0.9,
      reason: "not supported by evidence",
    });
    expect(result.success).toBe(false);
  });

  it("does not require objection_severity for approve votes", () => {
    const result = BallotSchema.safeParse({
      candidate_id: "cc_1",
      vote: "approve",
      confidence: 0.9,
      reason: "looks right",
    });
    expect(result.success).toBe(true);
  });
});

describe("Proposal schema", () => {
  it("requires at least one claim", () => {
    const result = ProposalSchema.safeParse({
      model_id: "model_a",
      answer_summary: "summary",
      claims: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed proposal", () => {
    const result = ProposalSchema.safeParse({
      model_id: "model_a",
      answer_summary: "summary",
      claims: [
        {
          claim_id: "a_c1",
          text: "claim text",
          type: "fact",
          confidence: 0.7,
          rationale: "because",
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

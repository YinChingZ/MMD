import { describe, expect, it } from "vitest";
import { CandidateClaimSchema } from "../src/schemas/normalize.js";
import { BallotSchema } from "../src/schemas/vote.js";
import { ProposalSchema, ClaimSchema } from "../src/schemas/propose.js";
import {
  FinalAnswerSchema,
  SectionAnswerSchema,
  PlanDocumentSchema,
} from "../src/schemas/compose.js";

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

describe("Claim schema — topic_id (v0.2 planning mode, backward compatible)", () => {
  const base = {
    claim_id: "a_c1",
    text: "claim text",
    type: "fact" as const,
    confidence: 0.7,
    rationale: "because",
  };

  it("accepts a claim without topic_id (standard/quick mode)", () => {
    expect(ClaimSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a claim with topic_id (planning mode)", () => {
    expect(
      ClaimSchema.safeParse({ ...base, topic_id: "database" }).success
    ).toBe(true);
  });
});

describe("CandidateClaim schema — topic_id (v0.2 planning mode, backward compatible)", () => {
  it("accepts a candidate claim without topic_id", () => {
    const result = CandidateClaimSchema.safeParse({
      candidate_id: "cc_1",
      text: "merged claim",
      source_claim_ids: ["a_c1"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a candidate claim with topic_id", () => {
    const result = CandidateClaimSchema.safeParse({
      candidate_id: "cc_1",
      text: "merged claim",
      source_claim_ids: ["a_c1"],
      topic_id: "database",
    });
    expect(result.success).toBe(true);
  });
});

describe("FinalAnswerSchema (v0.1, must stay unchanged by the v0.2 addition)", () => {
  it("still accepts the same shape as before", () => {
    const result = FinalAnswerSchema.safeParse({
      final_answer: "answer",
      strong_consensus: [],
      qualified_consensus: [],
      disputed_points: [],
      rejected_or_unsupported: [],
      model_position_changes: [],
      confidence_summary: { consensus_strength: "high", notes: "n" },
    });
    expect(result.success).toBe(true);
  });
});

describe("SectionAnswerSchema / PlanDocumentSchema (v0.2 planning mode)", () => {
  function section(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      topic_id: "database",
      title: "Database",
      tldr: "Use Postgres.",
      section_answer: "Use Postgres for the primary datastore.",
      strong_consensus: ["Use Postgres."],
      qualified_consensus: [],
      disputed_points: [],
      rejected_or_unsupported: [],
      model_position_changes: [],
      confidence_summary: { consensus_strength: "high", notes: "n" },
      ...overrides,
    };
  }

  it("requires tldr", () => {
    const { tldr, ...withoutTldr } = section();
    expect(SectionAnswerSchema.safeParse(withoutTldr).success).toBe(false);
  });

  it("accepts a well-formed section", () => {
    expect(SectionAnswerSchema.safeParse(section()).success).toBe(true);
  });

  it("PlanDocumentSchema requires at least one section", () => {
    const result = PlanDocumentSchema.safeParse({
      executive_summary: "summary",
      sections: [],
    });
    expect(result.success).toBe(false);
  });

  it("PlanDocumentSchema accepts an executive_summary plus sections", () => {
    const result = PlanDocumentSchema.safeParse({
      executive_summary: "summary",
      sections: [section()],
    });
    expect(result.success).toBe(true);
  });
});

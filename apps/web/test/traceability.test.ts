import type { Proposal, RevisionSet } from "@mmd/protocol";
import { describe, expect, it } from "vitest";
import { resolveSourceClaims } from "../src/lib/traceability";

const proposals: Proposal[] = [
  {
    model_id: "model_a",
    answer_summary: "summary a",
    claims: [
      {
        claim_id: "a_c1",
        text: "Original claim text",
        type: "fact",
        confidence: 0.8,
        rationale: "because",
        conditions: [],
      },
    ],
    assumptions: [],
    risks: [],
  },
  {
    model_id: "model_b",
    answer_summary: "summary b",
    claims: [
      {
        claim_id: "b_c1",
        text: "Untouched claim",
        type: "judgment",
        confidence: 0.6,
        rationale: "because b",
        conditions: [],
      },
    ],
    assumptions: [],
    risks: [],
  },
];

const revisions: RevisionSet[] = [
  {
    model_id: "model_a",
    revisions: [
      {
        original_claim_id: "a_c1",
        decision: "revise",
        revised_text: "Revised claim text",
        confidence: 0.9,
        reason_for_change: "convinced by critique",
        influenced_by: [],
      },
    ],
  },
];

describe("resolveSourceClaims", () => {
  it("resolves a claim with no revision", () => {
    const [resolved] = resolveSourceClaims(["b_c1"], proposals, revisions);
    expect(resolved).toEqual({
      claimId: "b_c1",
      modelId: "model_b",
      originalText: "Untouched claim",
      revision: undefined,
    });
  });

  it("attaches revision details when the claim was revised", () => {
    const [resolved] = resolveSourceClaims(["a_c1"], proposals, revisions);
    expect(resolved.modelId).toBe("model_a");
    expect(resolved.originalText).toBe("Original claim text");
    expect(resolved.revision).toEqual({
      decision: "revise",
      revised_text: "Revised claim text",
      reason_for_change: "convinced by critique",
    });
  });

  it("falls back gracefully for an unknown claim id", () => {
    const [resolved] = resolveSourceClaims(["missing"], proposals, revisions);
    expect(resolved.modelId).toBe("unknown");
    expect(resolved.originalText).toMatch(/not found/);
  });
});

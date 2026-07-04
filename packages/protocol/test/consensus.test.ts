import { describe, expect, it } from "vitest";
import { classifyCandidate } from "../src/consensus.js";
import type { Ballot } from "../src/schemas/vote.js";

function ballot(overrides: Partial<Ballot> & Pick<Ballot, "vote">): Ballot {
  return {
    candidate_id: "cc_1",
    confidence: 0.8,
    reason: "test",
    ...overrides,
  } as Ballot;
}

describe("classifyCandidate — ratio-based, model-count agnostic", () => {
  it("3 models, all approve -> strong_consensus", () => {
    const result = classifyCandidate({
      ballotsForCandidate: [
        ballot({ vote: "approve" }),
        ballot({ vote: "approve" }),
        ballot({ vote: "approve" }),
      ],
      expectedVoterCount: 3,
    });
    expect(result.label).toBe("strong_consensus");
    expect(result.approveRatio).toBe(1);
  });

  it("3 models, 2 approve + 1 approve_with_conditions -> strong_consensus", () => {
    const result = classifyCandidate({
      ballotsForCandidate: [
        ballot({ vote: "approve" }),
        ballot({ vote: "approve" }),
        ballot({ vote: "approve_with_conditions" }),
      ],
      expectedVoterCount: 3,
    });
    expect(result.label).toBe("strong_consensus");
  });

  it("3 models, 2 approve + 1 abstain -> qualified_consensus", () => {
    const result = classifyCandidate({
      ballotsForCandidate: [
        ballot({ vote: "approve" }),
        ballot({ vote: "approve" }),
        ballot({ vote: "abstain" }),
      ],
      expectedVoterCount: 3,
    });
    expect(result.label).toBe("qualified_consensus");
  });

  it("3 models, 1 critical objection -> disputed regardless of approve ratio", () => {
    const result = classifyCandidate({
      ballotsForCandidate: [
        ballot({ vote: "approve" }),
        ballot({ vote: "approve" }),
        ballot({ vote: "object", objection_severity: "critical" }),
      ],
      expectedVoterCount: 3,
    });
    expect(result.label).toBe("disputed");
    expect(result.hasCriticalObjection).toBe(true);
  });

  it("3 models, 0-1 approve -> rejected", () => {
    const result = classifyCandidate({
      ballotsForCandidate: [
        ballot({ vote: "approve" }),
        ballot({ vote: "object", objection_severity: "minor" }),
        ballot({ vote: "abstain" }),
      ],
      expectedVoterCount: 3,
    });
    expect(result.label).toBe("rejected");
  });

  it("5 models, 5/5 approve -> strong_consensus (no rewrite needed for model count change)", () => {
    const result = classifyCandidate({
      ballotsForCandidate: Array.from({ length: 5 }, () =>
        ballot({ vote: "approve" })
      ),
      expectedVoterCount: 5,
    });
    expect(result.label).toBe("strong_consensus");
  });

  it("5 models, 4/5 approve -> qualified_consensus", () => {
    const result = classifyCandidate({
      ballotsForCandidate: [
        ballot({ vote: "approve" }),
        ballot({ vote: "approve" }),
        ballot({ vote: "approve" }),
        ballot({ vote: "approve" }),
        ballot({ vote: "abstain" }),
      ],
      expectedVoterCount: 5,
    });
    expect(result.label).toBe("qualified_consensus");
    expect(result.approveRatio).toBeCloseTo(0.8);
  });

  it("7 models, 5/7 approve with one major objection -> disputed (not silently outvoted)", () => {
    const result = classifyCandidate({
      ballotsForCandidate: [
        ...Array.from({ length: 5 }, () => ballot({ vote: "approve" })),
        ballot({ vote: "object", objection_severity: "major" }),
        ballot({ vote: "abstain" }),
      ],
      expectedVoterCount: 7,
    });
    expect(result.hasMajorObjection).toBe(true);
    expect(result.label).toBe("disputed");
  });

  it("7 models, only 4 respondents -> partial flag set (quorum-relevant)", () => {
    const result = classifyCandidate({
      ballotsForCandidate: Array.from({ length: 4 }, () =>
        ballot({ vote: "approve" })
      ),
      expectedVoterCount: 7,
    });
    expect(result.partial).toBe(true);
    expect(result.approveRatio).toBeCloseTo(4 / 7);
  });

  it("rejects expectedVoterCount <= 0", () => {
    expect(() =>
      classifyCandidate({ ballotsForCandidate: [], expectedVoterCount: 0 })
    ).toThrow();
  });
});

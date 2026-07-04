import type { CandidateClaim, ClassifyCandidateResult } from "@mmd/protocol";
import { describe, expect, it } from "vitest";
import { bucketCandidatesByConsensus } from "../src/lib/consensus";

function candidate(id: string, sourceIds: string[] = ["c1"]): CandidateClaim {
  return { candidate_id: id, text: `text for ${id}`, source_claim_ids: sourceIds };
}

function classification(
  label: ClassifyCandidateResult["label"]
): ClassifyCandidateResult {
  return { label, approveRatio: 1, hasCriticalObjection: false, hasMajorObjection: false, partial: false };
}

describe("bucketCandidatesByConsensus", () => {
  it("groups candidates into the correct bucket by their classification label", () => {
    const candidates = [candidate("cc_1"), candidate("cc_2"), candidate("cc_3"), candidate("cc_4")];
    const classifications: Record<string, ClassifyCandidateResult> = {
      cc_1: classification("strong_consensus"),
      cc_2: classification("qualified_consensus"),
      cc_3: classification("disputed"),
      cc_4: classification("rejected"),
    };

    const buckets = bucketCandidatesByConsensus(candidates, classifications);
    expect(buckets.strong_consensus.map((c) => c.candidate_id)).toEqual(["cc_1"]);
    expect(buckets.qualified_consensus.map((c) => c.candidate_id)).toEqual(["cc_2"]);
    expect(buckets.disputed.map((c) => c.candidate_id)).toEqual(["cc_3"]);
    expect(buckets.rejected.map((c) => c.candidate_id)).toEqual(["cc_4"]);
  });

  it("keeps source_claim_ids on the bucketed candidate for traceability", () => {
    const candidates = [candidate("cc_1", ["a_c1", "b_c2"])];
    const classifications = { cc_1: classification("strong_consensus") };
    const buckets = bucketCandidatesByConsensus(candidates, classifications);
    expect(buckets.strong_consensus[0].source_claim_ids).toEqual(["a_c1", "b_c2"]);
  });
});

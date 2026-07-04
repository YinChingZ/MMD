import type { CandidateClaim, ClassifyCandidateResult } from "@mmd/protocol";

export interface ConsensusBuckets {
  strong_consensus: CandidateClaim[];
  qualified_consensus: CandidateClaim[];
  disputed: CandidateClaim[];
  rejected: CandidateClaim[];
}

// Same grouping packages/orchestrator/src/index.ts's computeConsensusBuckets()
// does internally to build final.strong_consensus/etc. (plain candidate.text
// arrays) — done here against the full CandidateClaim objects instead, so the
// UI can show source_claim_ids per bucket without reverse-matching text back
// to a candidate_id.
export function bucketCandidatesByConsensus(
  candidates: CandidateClaim[],
  classifications: Record<string, ClassifyCandidateResult>
): ConsensusBuckets {
  const buckets: ConsensusBuckets = {
    strong_consensus: [],
    qualified_consensus: [],
    disputed: [],
    rejected: [],
  };
  for (const candidate of candidates) {
    const label = classifications[candidate.candidate_id]?.label ?? "disputed";
    buckets[label].push(candidate);
  }
  return buckets;
}

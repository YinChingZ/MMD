import type { Proposal, Revision, RevisionSet } from "@mmd/protocol";

export interface ResolvedSourceClaim {
  claimId: string;
  modelId: string;
  originalText: string;
  revision?: Pick<Revision, "decision" | "revised_text" | "reason_for_change">;
}

// Frontend-only replica of the lookup packages/orchestrator/src/index.ts's
// resolveFinalClaims() does internally (not imported — it's a non-exported
// helper, and this version deliberately keeps withdrawn/superseded claims
// visible instead of dropping them, since the point here is showing the full
// pre-merge history behind a candidate, not just the final resolved text).
export function resolveSourceClaims(
  sourceClaimIds: string[],
  proposals: Proposal[],
  revisions: RevisionSet[]
): ResolvedSourceClaim[] {
  const claimById = new Map<string, { modelId: string; text: string }>();
  for (const proposal of proposals) {
    for (const claim of proposal.claims) {
      claimById.set(claim.claim_id, {
        modelId: proposal.model_id,
        text: claim.text,
      });
    }
  }

  const revisionByClaimId = new Map<string, Revision>();
  for (const set of revisions) {
    for (const revision of set.revisions) {
      revisionByClaimId.set(revision.original_claim_id, revision);
    }
  }

  return sourceClaimIds.map((claimId) => {
    const claim = claimById.get(claimId);
    const revision = revisionByClaimId.get(claimId);
    return {
      claimId,
      modelId: claim?.modelId ?? "unknown",
      originalText: claim?.text ?? "(original claim not found)",
      revision: revision
        ? {
            decision: revision.decision,
            revised_text: revision.revised_text,
            reason_for_change: revision.reason_for_change,
          }
        : undefined,
    };
  });
}

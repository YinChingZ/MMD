import type { CandidateClaim } from "@mmd/protocol";

/**
 * Deliberately distinct from CandidateClaimItem.tsx: that component needs
 * the whole run's proposals/revisions in scope to resolve source claims,
 * which aren't available yet for a live mid-stream preview — this only
 * renders the candidate's own fields.
 */
export function CandidateClaimPreview({ candidate }: { candidate: CandidateClaim }) {
  return (
    <li>
      {candidate.text}{" "}
      <span className="text-gray-400">
        ({candidate.source_claim_ids.length} source claim
        {candidate.source_claim_ids.length === 1 ? "" : "s"})
      </span>
    </li>
  );
}

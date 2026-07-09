import type { Ballot, CandidateClaim, Claim, Phase, Review, Revision } from "@mmd/protocol";
import type { PhaseItemProgress, PhaseStatus } from "@/lib/progress";
import { ProposalClaimPreview } from "./ProposalClaimPreview";
import { ReviewPreview } from "./ReviewPreview";
import { RevisionPreview } from "./RevisionPreview";
import { BallotPreview } from "./BallotPreview";
import { CandidateClaimPreview } from "./CandidateClaimPreview";

function renderItems(arrayField: string, items: unknown[]) {
  switch (arrayField) {
    case "claims":
      return (items as Claim[]).map((claim) => (
        <ProposalClaimPreview key={claim.claim_id} claim={claim} />
      ));
    case "reviews":
      return (items as Review[]).map((review, i) => (
        <ReviewPreview key={i} review={review} />
      ));
    case "revisions":
      return (items as Revision[]).map((revision, i) => (
        <RevisionPreview key={i} revision={revision} />
      ));
    case "votes":
      return (items as Ballot[]).map((ballot, i) => (
        <BallotPreview key={i} ballot={ballot} />
      ));
    case "candidate_claims":
      return (items as CandidateClaim[]).map((candidate) => (
        <CandidateClaimPreview key={candidate.candidate_id} candidate={candidate} />
      ));
    default:
      return null;
  }
}

/** Live preview of claims/reviews/revisions/votes/candidates as each one
 * streams in — only rendered for phases currently in_progress, since once a
 * phase completes the full (post-stamped) result eventually renders via
 * DiscussionProcess/ConsensusPanel instead. */
export function LivePhaseItems({
  itemProgress,
  phases,
}: {
  itemProgress: Partial<Record<Phase, PhaseItemProgress>>;
  phases: Partial<Record<Phase, PhaseStatus>>;
}) {
  const activeEntries = (Object.entries(itemProgress) as [Phase, PhaseItemProgress][]).filter(
    ([phase, byModel]) => phases[phase] === "in_progress" && Object.keys(byModel).length > 0
  );

  if (activeEntries.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {activeEntries.map(([phase, byModel]) => (
        <div key={phase} className="rounded border border-gray-100 p-2 text-xs">
          <p className="mb-1 font-medium text-gray-500">{phase}</p>
          <div className="flex flex-col gap-1.5">
            {Object.values(byModel).map((entry) => (
              <div key={entry.modelId}>
                <span className="font-medium">{entry.modelId}</span>
                <ul className="ml-3 list-disc text-gray-500">
                  {renderItems(entry.arrayField, entry.items)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

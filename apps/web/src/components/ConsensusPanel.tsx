import type {
  CandidateClaim,
  ClassifyCandidateResult,
  Proposal,
  RevisionSet,
} from "@mmd/protocol";
import { bucketCandidatesByConsensus, type ConsensusBuckets } from "@/lib/consensus";
import { CandidateClaimItem } from "./CandidateClaimItem";

const SECTIONS: { key: keyof ConsensusBuckets; label: string; color: string }[] = [
  { key: "strong_consensus", label: "Strong consensus", color: "var(--consensus-strong)" },
  { key: "qualified_consensus", label: "Qualified consensus", color: "var(--consensus-qualified)" },
  { key: "disputed", label: "Disputed", color: "var(--consensus-disputed)" },
  { key: "rejected", label: "Rejected / unsupported", color: "var(--consensus-rejected)" },
];

export function ConsensusPanel({
  candidates,
  classifications,
  proposals,
  revisions,
}: {
  candidates: CandidateClaim[];
  classifications: Record<string, ClassifyCandidateResult>;
  proposals: Proposal[];
  revisions: RevisionSet[];
}) {
  const buckets = bucketCandidatesByConsensus(candidates, classifications);
  return (
    <div className="flex flex-col gap-3">
      {SECTIONS.map((section) => {
        const items = buckets[section.key];
        if (items.length === 0) return null;
        return (
          <div key={section.key}>
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: section.color }}
              />
              {section.label} ({items.length})
            </h3>
            <ul>
              {items.map((candidate) => (
                <CandidateClaimItem
                  key={candidate.candidate_id}
                  candidate={candidate}
                  proposals={proposals}
                  revisions={revisions}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

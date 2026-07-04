"use client";

import { useState } from "react";
import type { CandidateClaim, Proposal, RevisionSet } from "@mmd/protocol";
import { resolveSourceClaims } from "@/lib/traceability";

export function CandidateClaimItem({
  candidate,
  proposals,
  revisions,
}: {
  candidate: CandidateClaim;
  proposals: Proposal[];
  revisions: RevisionSet[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-gray-100 py-2 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-2 text-left text-sm"
      >
        <span>{candidate.text}</span>
        <span className="shrink-0 text-xs text-gray-400">
          {open ? "hide sources" : "show sources"}
        </span>
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5 rounded bg-gray-50 p-2 text-xs">
          {resolveSourceClaims(candidate.source_claim_ids, proposals, revisions).map(
            (claim) => (
              <li key={claim.claimId}>
                <span className="font-medium">{claim.modelId}</span>: {claim.originalText}
                {claim.revision && claim.revision.decision !== "keep" && (
                  <div className="mt-0.5 text-gray-500">
                    → {claim.revision.decision}
                    {claim.revision.revised_text && `: "${claim.revision.revised_text}"`} (
                    {claim.revision.reason_for_change})
                  </div>
                )}
              </li>
            )
          )}
        </ul>
      )}
    </li>
  );
}

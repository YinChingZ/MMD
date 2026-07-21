"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type {
  CandidateClaim,
  ClassificationBasis,
  Proposal,
  RevisionSet,
  VoteSet,
} from "@mmd/protocol";
import { cn } from "../../lib/cn";
import { messages } from "../../lib/messages";
import { resolveSourceClaims } from "../../lib/traceability";
import { ModelChip } from "../run/ModelChip";

/** 单条候选主张：展开「查看证据」显示源主张、修订决策与各模型立场。 */
export function CandidateClaimItem({
  candidate,
  proposals,
  revisions,
  basis,
  votes = [],
  showTraceMetadata = false,
}: {
  candidate: CandidateClaim;
  proposals: Proposal[];
  revisions: RevisionSet[];
  basis?: ClassificationBasis;
  votes?: VoteSet[];
  showTraceMetadata?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ballots = votes.flatMap((voteSet) =>
    voteSet.votes
      .filter((ballot) => ballot.candidate_id === candidate.candidate_id)
      .map((ballot) => ({ modelId: voteSet.model_id, ballot })),
  );

  return (
    <li className="border-b border-border py-2.5 last:border-0 last:pb-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm leading-relaxed text-ink">
            {candidate.text}
          </span>
          {showTraceMetadata && (
            <span className="mt-1 block break-all font-mono text-[10px] text-ink-faint">
              {candidate.candidate_id} · {messages.results.sourceClaimCount(candidate.source_claim_ids.length)}
              {basis
                ? ` · ${Math.round(basis.approve_ratio * 100)}% · ${messages.results.ballotCount(basis.ballots.length, basis.expected_voter_count)}${basis.partial ? ` · ${messages.results.partial}` : ""}`
                : ` · ${messages.results.classificationBasisUnavailable}`}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs text-ink-faint">
          {messages.results.viewEvidence}
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
          />
        </span>
      </button>
      {open && (
        <div className="mmd-enter mt-2 rounded-md bg-surface-muted p-3">
          {basis && (
            <div className="mb-3 border-b border-border pb-3">
              <p className="text-xs font-semibold text-ink">
                {messages.results.classificationBasis}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {messages.results.classificationSummary(
                  Math.round(basis.approve_ratio * 100),
                  basis.ballots.length,
                  basis.expected_voter_count,
                )}
              </p>
              {ballots.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-muted">
                  {ballots.map(({ modelId, ballot }, index) => (
                    <li key={`${modelId}-${index}`}>
                      {modelId} · {ballot.vote}
                      {ballot.objection_severity
                        ? ` / ${ballot.objection_severity}`
                        : ""}
                      ：{ballot.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <ul className="flex flex-col gap-2">
          {resolveSourceClaims(
            candidate.source_claim_ids,
            proposals,
            revisions,
          ).map((claim) => (
            <li key={claim.claimId} className="text-xs leading-relaxed">
              <div className="flex items-start gap-2">
                <ModelChip modelId={claim.modelId} size="sm" showName />
              </div>
              <p className="mt-1 text-ink">{claim.originalText}</p>
              {claim.revision && claim.revision.decision !== "keep" && (
                <p className="mt-1 text-ink-muted">
                  → {claim.revision.decision}
                  {claim.revision.revised_text &&
                    `：“${claim.revision.revised_text}”`}
                  （{claim.revision.reason_for_change}）
                </p>
              )}
            </li>
          ))}
          </ul>
        </div>
      )}
    </li>
  );
}

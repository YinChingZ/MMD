"use client";

import { useEffect, useRef } from "react";
import type {
  Ballot,
  CandidateClaim,
  Claim,
  Phase,
  Review,
  Revision,
} from "@mmd/protocol";
import { messages } from "../../lib/messages";
import type { PhaseItemProgress, PhaseStatus } from "../../lib/progress";
import { Badge } from "../ui/badge";
import { ModelChip } from "./ModelChip";
import { ProposalClaimPreview } from "../ProposalClaimPreview";
import { ReviewPreview } from "../ReviewPreview";
import { RevisionPreview } from "../RevisionPreview";
import { BallotPreview } from "../BallotPreview";
import { CandidateClaimPreview } from "../CandidateClaimPreview";

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

/**
 * 中央实时产物流：进行中阶段的 claims/reviews/votes 以卡片流式出现。
 * 仅渲染 in_progress 的阶段——阶段完成后由完成态视图接管完整结果。
 * 新增内容时若用户接近底部则自动跟随。
 */
export function ActivityStream({
  itemProgress,
  phases,
}: {
  itemProgress: Partial<Record<Phase, PhaseItemProgress>>;
  phases: Partial<Record<Phase, PhaseStatus>>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeEntries = (
    Object.entries(itemProgress) as [Phase, PhaseItemProgress][]
  ).filter(
    ([phase, byModel]) =>
      phases[phase] === "in_progress" && Object.keys(byModel).length > 0,
  );

  const itemCount = activeEntries.reduce(
    (sum, [, byModel]) =>
      sum + Object.values(byModel).reduce((s, e) => s + e.items.length, 0),
    0,
  );

  // 自动跟随：距滚动容器底部 <200px 才跟随，用户上滚阅读时不打扰
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const scroller = el.closest("main, [data-scroll-region]");
    if (scroller) {
      const dist =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (dist > 200) return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [itemCount]);

  if (activeEntries.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-ink-faint">
        {messages.run.liveActivity}
      </p>
      {activeEntries.map(([phase, byModel]) => (
        <div key={phase} className="flex flex-col gap-2">
          {Object.values(byModel).map((entry) => (
            <div
              key={entry.modelId}
              className="mmd-enter rounded-md border border-border bg-surface p-3 shadow-card"
            >
              <div className="mb-1.5 flex items-center gap-2">
                <ModelChip modelId={entry.modelId} showName />
                <Badge tone="accent">
                  {messages.run.phases[phase] ?? phase}
                </Badge>
              </div>
              <ul className="ml-4 list-disc text-xs leading-relaxed text-ink-muted">
                {renderItems(entry.arrayField, entry.items)}
              </ul>
            </div>
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

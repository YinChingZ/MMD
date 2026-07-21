"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Ballot,
  CandidateClaim,
  Claim,
  Phase,
  Review,
  Revision,
} from "@mmd/protocol";
import { cn } from "../../lib/cn";
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
 * 中央实时产物流：某一阶段的 claims/reviews/votes 卡片。默认聚焦当前
 * 进行中（或最近）的阶段，也可通过顶部 tab（或右栏 ProtocolTimeline 联动）
 * 切换查看任意已有数据的阶段——deriveRunProgress 不会清空旧阶段的
 * itemProgress，所以这里纯读取即可，不需要额外状态或后端支持。
 * 新增内容时若用户接近底部则自动跟随。
 */
export function ActivityStream({
  itemProgress,
  phases,
  phaseOrder,
  selectedPhase,
  onSelectPhase,
  phaseLabelFor = (phase) => messages.run.phases[phase] ?? phase,
}: {
  itemProgress: Partial<Record<Phase, PhaseItemProgress>>;
  phases: Partial<Record<Phase, PhaseStatus>>;
  phaseOrder: Phase[];
  selectedPhase?: Phase;
  onSelectPhase?: (phase: Phase) => void;
  phaseLabelFor?: (phase: Phase) => string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  // 未受外部（RunPageClient）控制时（如 planning 模式每个主题卡片各自独立），
  // 退化为自管理的 tab 状态，两种用法共用同一套渲染逻辑。
  const [internalSelected, setInternalSelected] = useState<Phase | undefined>(
    undefined,
  );
  const effectiveSelected = selectedPhase ?? internalSelected;
  const selectPhase = (phase: Phase) => {
    setInternalSelected(phase);
    onSelectPhase?.(phase);
  };

  const available = phaseOrder.filter(
    (phase) => Object.keys(itemProgress[phase] ?? {}).length > 0,
  );
  const active =
    effectiveSelected && available.includes(effectiveSelected)
      ? effectiveSelected
      : available[available.length - 1];
  const byModel = active ? (itemProgress[active] ?? {}) : {};

  const itemCount = Object.values(byModel).reduce(
    (sum, e) => sum + e.items.length,
    0,
  );

  // 自动跟随：距滚动容器底部 <200px 才跟随；用户手动切到较早阶段时该阶段
  // 不会再有新条目，itemCount 不变，也就不会打断阅读。
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

  if (available.length === 0 || !active) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1">
        <p className="mr-1 text-xs font-medium text-ink-faint">
          {messages.run.liveActivity}
        </p>
        {available.map((phase) => (
          <button
            key={phase}
            type="button"
            onClick={() => selectPhase(phase)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              phase === active
                ? "bg-live-muted text-live"
                : "text-ink-faint hover:bg-surface-hover hover:text-ink",
            )}
          >
            {phaseLabelFor(phase)}
            {phases[phase] === "in_progress" && (
              <span
                aria-hidden
                className="mmd-pulse h-1.5 w-1.5 rounded-full bg-live"
              />
            )}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Object.values(byModel).map((entry) => (
          <div
            key={entry.modelId}
            className="mmd-enter rounded-md border border-border bg-surface p-3 shadow-card"
          >
            <div className="mb-1.5 flex items-center gap-2">
              <ModelChip modelId={entry.modelId} showName />
              <Badge tone="accent">{phaseLabelFor(active)}</Badge>
            </div>
            <ul className="ml-4 list-disc text-xs leading-relaxed text-ink-muted">
              {renderItems(entry.arrayField, entry.items)}
            </ul>
          </div>
        ))}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { Critique, Proposal, RevisionSet, VoteSet } from "@mmd/protocol";
import { cn } from "../../lib/cn";
import { messages } from "../../lib/messages";
import { PHASE_ICONS } from "../run/ProtocolTimeline";
import { ModelChip } from "../run/ModelChip";

function PhaseSection({
  phase,
  count,
  children,
}: {
  phase: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Icon = PHASE_ICONS[phase];
  return (
    <div className="border-t border-border py-2 first:border-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-ink"
      >
        {Icon && <Icon className="h-4 w-4 text-ink-muted" />}
        {messages.run.phases[phase] ?? phase}
        <span className="text-xs font-normal text-ink-faint">{count}</span>
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 text-ink-faint transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="mmd-enter mt-2 flex flex-col gap-3">{children}</div>}
    </div>
  );
}

function ModelBlock({ modelId, children }: { modelId: string; children: ReactNode }) {
  return (
    <div className="rounded-md bg-surface-muted p-3">
      <ModelChip modelId={modelId} size="sm" showName />
      <div className="mt-1.5 text-xs leading-relaxed text-ink-muted">{children}</div>
    </div>
  );
}

/** 审议过程：默认收起的分阶段完整记录（各模型原始产出）。 */
export function DeliberationRecord({
  proposals,
  critiques,
  revisions,
  votes,
}: {
  proposals: Proposal[];
  critiques: Critique[];
  revisions: RevisionSet[];
  votes: VoteSet[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-ink">
            {messages.results.deliberationRecord}
          </span>
          <span className="block text-xs text-ink-faint">
            {messages.results.deliberationHint}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-ink-faint transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="mmd-enter mt-3 flex flex-col">
          <PhaseSection phase="propose" count={proposals.length}>
            {proposals.map((p) => (
              <ModelBlock key={p.model_id} modelId={p.model_id}>
                <p className="mb-1 text-ink">{p.answer_summary}</p>
                <ul className="ml-4 list-disc">
                  {p.claims.map((c) => (
                    <li key={c.claim_id}>
                      {c.text}{" "}
                      <span className="text-ink-faint">
                        （{c.type}，confidence {c.confidence}）
                      </span>
                    </li>
                  ))}
                </ul>
              </ModelBlock>
            ))}
          </PhaseSection>

          <PhaseSection phase="critique" count={critiques.length}>
            {critiques.map((c) => (
              <ModelBlock key={c.reviewer_model_id} modelId={c.reviewer_model_id}>
                <ul className="ml-4 list-disc">
                  {c.reviews.map((r, i) => (
                    <li key={i}>
                      {r.stance}/{r.severity} · {r.target_claim_id}：{r.comment}
                    </li>
                  ))}
                </ul>
              </ModelBlock>
            ))}
          </PhaseSection>

          <PhaseSection phase="revise" count={revisions.length}>
            {revisions.map((r) => (
              <ModelBlock key={r.model_id} modelId={r.model_id}>
                <ul className="ml-4 list-disc">
                  {r.revisions.map((rev, i) => (
                    <li key={i}>
                      {rev.decision} {rev.original_claim_id}
                      {rev.revised_text ? `：“${rev.revised_text}”` : ""} ——{" "}
                      {rev.reason_for_change}
                    </li>
                  ))}
                </ul>
              </ModelBlock>
            ))}
          </PhaseSection>

          <PhaseSection phase="vote" count={votes.length}>
            {votes.map((v) => (
              <ModelBlock key={v.model_id} modelId={v.model_id}>
                <ul className="ml-4 list-disc">
                  {v.votes.map((b, i) => (
                    <li key={i}>
                      {b.vote} · {b.candidate_id}
                      {b.objection_severity ? `（${b.objection_severity}）` : ""}：
                      {b.reason}
                    </li>
                  ))}
                </ul>
              </ModelBlock>
            ))}
          </PhaseSection>
        </div>
      )}
    </section>
  );
}

"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type {
  CandidateClaim,
  ClassifyCandidateResult,
  ClassificationBasis,
  Proposal,
  RevisionSet,
  VoteSet,
} from "@mmd/protocol";
import {
  bucketCandidatesByConsensus,
  type ConsensusBuckets,
} from "../../lib/consensus";
import { cn } from "../../lib/cn";
import { messages } from "../../lib/messages";
import { Badge } from "../ui/badge";
import { CandidateClaimItem } from "./CandidateClaimItem";

type BucketKey = keyof ConsensusBuckets;

interface BucketSpec {
  key: BucketKey;
  msgKey: "strong" | "qualified" | "disputed" | "rejected";
  tone: "strong" | "qualified" | "disputed" | "rejected";
  Icon: LucideIcon;
  border: string;
  text: string;
}

export const BUCKET_SPECS: BucketSpec[] = [
  {
    key: "strong_consensus",
    msgKey: "strong",
    tone: "strong",
    Icon: ShieldCheck,
    border: "border-l-consensus-strong",
    text: "text-consensus-strong",
  },
  {
    key: "qualified_consensus",
    msgKey: "qualified",
    tone: "qualified",
    Icon: CheckCircle2,
    border: "border-l-consensus-qualified",
    text: "text-consensus-qualified",
  },
  {
    key: "disputed",
    msgKey: "disputed",
    tone: "disputed",
    Icon: AlertTriangle,
    border: "border-l-consensus-disputed",
    text: "text-consensus-disputed",
  },
  {
    key: "rejected",
    msgKey: "rejected",
    tone: "rejected",
    Icon: CircleSlash,
    border: "border-l-consensus-rejected",
    text: "text-consensus-rejected",
  },
];

/** 中央共识区：四类分区（颜色 + 图标 + 文本三重标识），空类折叠为一行。 */
export function ConsensusSection({
  candidates,
  classifications,
  proposals,
  revisions,
  idPrefix = "consensus",
  classificationBasis,
  votes,
  showTraceMetadata = false,
}: {
  candidates: CandidateClaim[];
  classifications: Record<string, ClassifyCandidateResult>;
  proposals: Proposal[];
  revisions: RevisionSet[];
  idPrefix?: string;
  classificationBasis?: Record<string, ClassificationBasis>;
  votes?: VoteSet[];
  showTraceMetadata?: boolean;
}) {
  const buckets = bucketCandidatesByConsensus(candidates, classifications);
  return (
    <div className="flex flex-col gap-3">
      {BUCKET_SPECS.map(({ key, msgKey, tone, Icon, border, text }) => {
        const items = buckets[key];
        const label = messages.results.consensus[msgKey];
        if (items.length === 0) {
          return (
            <p key={key} className="flex items-center gap-2 px-1 text-xs text-ink-faint">
              <Icon className="h-3.5 w-3.5" />
              {label} · 0
            </p>
          );
        }
        return (
          <section
            key={key}
            id={`${idPrefix}-${key}`}
            className={cn(
              "rounded-md border border-border border-l-4 bg-surface p-4 shadow-card",
              border,
            )}
          >
            <h3 className={cn("flex items-center gap-2 text-sm font-semibold", text)}>
              <Icon className="h-4 w-4" />
              {label}
              <Badge tone={tone}>{messages.results.claims(items.length)}</Badge>
            </h3>
            <ul className="mt-2 flex flex-col">
              {items.map((candidate) => (
                <CandidateClaimItem
                  key={candidate.candidate_id}
                  candidate={candidate}
                  proposals={proposals}
                  revisions={revisions}
                  basis={classificationBasis?.[candidate.candidate_id]}
                  votes={votes}
                  showTraceMetadata={showTraceMetadata}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** 右栏共识总览：四类计数 + 点击滚动定位。 */
export function ConsensusSummary({
  candidates,
  classifications,
  idPrefix = "consensus",
}: {
  candidates: CandidateClaim[];
  classifications: Record<string, ClassifyCandidateResult>;
  idPrefix?: string;
}) {
  const buckets = bucketCandidatesByConsensus(candidates, classifications);
  return (
    <ul className="flex flex-col gap-1.5">
      {BUCKET_SPECS.map(({ key, msgKey, Icon, text }) => {
        const count = buckets[key].length;
        return (
          <li key={key}>
            <button
              type="button"
              disabled={count === 0}
              onClick={() =>
                document
                  .getElementById(`${idPrefix}-${key}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left transition-colors",
                count > 0
                  ? "hover:bg-surface-hover"
                  : "cursor-default opacity-50",
              )}
            >
              <span className={cn("flex items-center gap-2 text-sm", text)}>
                <Icon className="h-4 w-4" />
                {messages.results.consensus[msgKey]}
              </span>
              <span className="text-sm font-medium text-ink">{count}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

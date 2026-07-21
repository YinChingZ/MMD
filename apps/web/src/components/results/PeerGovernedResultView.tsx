"use client";

import { AlertTriangle, ChevronDown, GitMerge, ShieldCheck } from "lucide-react";
import type { RunResult } from "@/lib/api";
import { messages } from "@/lib/messages";
import {
  classificationBasisFor,
  candidateSetTrace,
  partialQuorumEntries,
  traceHasFailure,
} from "@/lib/result-trace";
import { Badge } from "../ui/badge";
import { ConsensusSection } from "./ConsensusSection";
import { DeliberationRecord } from "./DeliberationRecord";
import { FinalAnswerCard } from "./FinalAnswerCard";

export function PeerGovernedResultView({ result }: { result: RunResult }) {
  const candidateIds = result.normalize.candidate_claims.map(
    (candidate) => candidate.candidate_id,
  );
  const classificationBasis = classificationBasisFor(
    result.trace,
    candidateIds,
  );
  const partialQuorum = partialQuorumEntries(result.trace, ["align", "vote"]);
  const deterministicFallback = traceHasFailure(result.trace, "compose");
  const alignment = candidateSetTrace(result.trace, candidateIds)?.alignment as
    | {
        policy?: { version?: string; minimum_pair_support?: number };
        alignments?: Array<{
          aligner_model_id?: string;
          judgments?: Array<{
            left_claim_id?: string;
            right_claim_id?: string;
            relation?: string;
            confidence?: number;
            reason?: string;
          }>;
        }>;
        decisions?: Array<{
          left?: string[];
          right?: string[];
          action?: string;
          reason?: string;
        }>;
      }
    | undefined;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-consensus-strong" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-ink">
                {messages.results.authoritativeLedger}
              </h2>
              <Badge tone="qualified">{messages.results.authoritative}</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              {messages.results.authoritativeLedgerHint}
            </p>
          </div>
        </div>

        {partialQuorum.length > 0 && (
          <div className="mt-4 flex gap-2 rounded-md border border-consensus-disputed/30 bg-consensus-disputed-bg p-3 text-sm text-consensus-disputed">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">{messages.results.partialQuorum}</p>
              {partialQuorum.map((entry) => (
                <p key={`${entry.phase}-${entry.topic_id ?? "root"}`} className="mt-0.5 text-xs">
                  {entry.phase}: {entry.respondent_count}/{entry.expected_count}，
                  {messages.results.quorumRequired(entry.required)}
                </p>
              ))}
            </div>
          </div>
        )}
      </section>

      <ConsensusSection
        candidates={result.normalize.candidate_claims}
        classifications={result.classifications}
        proposals={result.proposals}
        revisions={result.revisions}
        classificationBasis={classificationBasis}
        votes={result.votes}
        showTraceMetadata
      />

      {alignment && (
        <details className="group rounded-lg border border-border bg-surface p-4 shadow-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-left">
            <span>
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                <GitMerge className="h-4 w-4 text-accent" />
                {messages.results.alignmentTrace}
              </span>
              <span className="mt-0.5 block text-xs text-ink-faint">
                {messages.results.alignmentTraceHint(
                  alignment.alignments?.length ?? 0,
                  alignment.decisions?.length ?? 0,
                )}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 text-ink-faint transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
            {alignment.policy && (
              <p className="font-mono text-[11px] text-ink-faint">
                {alignment.policy.version} · minimum support {alignment.policy.minimum_pair_support}
              </p>
            )}
            {alignment.alignments?.map((aligner, alignerIndex) => (
              <section key={aligner.aligner_model_id ?? alignerIndex} className="rounded-md bg-surface-muted p-3">
                <h3 className="text-xs font-semibold text-ink">
                  {aligner.aligner_model_id ?? messages.results.unknownAligner}
                </h3>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-muted">
                  {aligner.judgments?.map((judgment, index) => (
                    <li key={`${judgment.left_claim_id}-${judgment.right_claim_id}-${index}`}>
                      <code>{judgment.left_claim_id}</code> ↔ <code>{judgment.right_claim_id}</code>
                      {` · ${judgment.relation ?? "unknown"}`}
                      {judgment.confidence !== undefined
                        ? ` · ${Math.round(judgment.confidence * 100)}%`
                        : ""}
                      {judgment.reason ? `：${judgment.reason}` : ""}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {(alignment.decisions?.length ?? 0) > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-ink">
                  {messages.results.clusterDecisions}
                </h3>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-muted">
                  {alignment.decisions?.map((decision, index) => (
                    <li key={index}>
                      {decision.left?.join(", ")} ↔ {decision.right?.join(", ")} ·{
                      " "
                      }{decision.action} / {decision.reason}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </details>
      )}

      <FinalAnswerCard
        text={result.final.final_answer}
        result={result}
        title={
          deterministicFallback
            ? messages.results.deterministicFallback
            : messages.results.nonAuthoritativeProse
        }
        notice={
          deterministicFallback
            ? messages.results.deterministicFallbackHint
            : messages.results.nonAuthoritativeProseHint
        }
      />

      <DeliberationRecord
        proposals={result.proposals}
        critiques={result.critiques}
        revisions={result.revisions}
        votes={result.votes}
      />
    </div>
  );
}

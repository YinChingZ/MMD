"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  GitBranch,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { TopicResult } from "@mmd/orchestrator";
import type { PlanningFinalAnswer } from "@mmd/protocol";
import type { RunResult } from "@/lib/api";
import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import {
  classificationBasisFor,
  traceHasFailure,
} from "@/lib/result-trace";
import { Badge } from "../ui/badge";
import { ConsensusSection } from "./ConsensusSection";
import { DeliberationRecord } from "./DeliberationRecord";
import { FinalAnswerCard } from "./FinalAnswerCard";

interface CandidateLocation {
  topicId: string;
  topicTitle: string;
  text: string;
}

function TopicTrace({
  topic,
  result,
}: {
  topic: TopicResult;
  result: RunResult;
}) {
  const candidateIds = topic.normalize.candidate_claims.map(
    (candidate) => candidate.candidate_id,
  );
  return (
    <details className="group rounded-md border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink">
        <span>{topic.topic.title}</span>
        <span className="flex items-center gap-2">
          <Badge tone="neutral">
            {messages.results.claims(candidateIds.length)}
          </Badge>
          <ChevronDown className="h-4 w-4 text-ink-faint transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-border p-4">
        <ConsensusSection
          candidates={topic.normalize.candidate_claims}
          classifications={topic.classifications}
          proposals={topic.proposals}
          revisions={topic.revisions}
          votes={topic.votes}
          classificationBasis={classificationBasisFor(
            result.trace,
            candidateIds,
            topic.topic.topic_id,
          )}
          idPrefix={`planning-${topic.topic.topic_id}`}
          showTraceMetadata
        />
        <DeliberationRecord
          proposals={topic.proposals}
          critiques={topic.critiques}
          revisions={topic.revisions}
          votes={topic.votes}
        />
      </div>
    </details>
  );
}

export function PlanningFinalView({ result }: { result: RunResult }) {
  const planningFinal = result.planningFinal as PlanningFinalAnswer;
  const topics = result.topics ?? [];
  const [traceOpen, setTraceOpen] = useState(false);
  const globalComposeFailed = traceHasFailure(result.trace, "global_compose");
  const candidateIndex = new Map<string, CandidateLocation>();

  for (const topic of topics) {
    for (const candidate of topic.normalize.candidate_claims) {
      candidateIndex.set(candidate.candidate_id, {
        topicId: topic.topic.topic_id,
        topicTitle: topic.topic.title,
        text: candidate.text,
      });
    }
  }

  const synthesisSpans = planningFinal.spans.filter(
    (span) => span.lineage_kind === "coordinator_synthesis",
  );

  const sourceSummary = (candidateIds: string[]) => {
    const locations = candidateIds
      .map((id) => candidateIndex.get(id))
      .filter((value): value is CandidateLocation => Boolean(value));
    const topicTitles = [...new Set(locations.map((item) => item.topicTitle))];
    return topicTitles.length > 0
      ? topicTitles.join(" → ")
      : messages.results.lineageUnavailable;
  };

  return (
    <div className="flex flex-col gap-4">
      <FinalAnswerCard
        text={planningFinal.final_answer}
        result={result}
        title={messages.results.integratedPlanningAnswer}
        notice={
          globalComposeFailed
            ? messages.results.globalComposeFallbackHint
            : messages.results.integratedPlanningAnswerHint
        }
      />

      {globalComposeFailed && (
        <div className="flex gap-2 rounded-md border border-consensus-disputed/30 bg-consensus-disputed-bg p-3 text-sm text-consensus-disputed">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {messages.results.globalComposeFallback}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <button
          type="button"
          aria-expanded={traceOpen}
          onClick={() => setTraceOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span>
            <span className="block text-sm font-semibold text-ink">
              {messages.results.planningTrace}
            </span>
            <span className="mt-0.5 block text-xs text-ink-faint">
              {messages.results.planningTraceHint(topics.length, planningFinal.spans.length)}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-ink-faint transition-transform",
              traceOpen && "rotate-180",
            )}
          />
        </button>

        {traceOpen && (
          <div className="mmd-enter mt-4 flex flex-col gap-5 border-t border-border pt-4">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <GitBranch className="h-4 w-4 text-accent" />
                {messages.results.outputLineage}
              </h3>
              <div className="mt-3 flex flex-col gap-2">
                {planningFinal.spans.map((span) => {
                  const synthesis = span.lineage_kind === "coordinator_synthesis";
                  const lineageIds = synthesis
                    ? span.derived_from_candidate_ids
                    : span.source_candidate_ids;
                  return (
                    <article
                      key={span.span_id}
                      className={cn(
                        "rounded-md border border-border border-l-4 p-3",
                        synthesis
                          ? "border-l-accent bg-accent-muted/20"
                          : "border-l-consensus-strong bg-consensus-strong-bg/30",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {synthesis ? (
                          <Sparkles className="h-4 w-4 text-accent" />
                        ) : (
                          <ShieldCheck className="h-4 w-4 text-consensus-strong" />
                        )}
                        <Badge tone={synthesis ? "accent" : "strong"}>
                          {synthesis
                            ? messages.results.coordinatorSynthesis
                            : messages.results.panelConsensus}
                        </Badge>
                        <code className="text-[10px] text-ink-faint">{span.span_id}</code>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-ink">{span.text}</p>
                      <p className="mt-2 text-xs text-ink-muted">
                        {messages.results.sources}: {sourceSummary(lineageIds)}
                      </p>
                      <p className="mt-1 break-all font-mono text-[10px] text-ink-faint">
                        {lineageIds.join(" · ")}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>

            {synthesisSpans.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  {messages.results.crossTopicDependencies}
                </h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {synthesisSpans.map((span) => (
                    <li key={span.span_id} className="rounded-md bg-surface-muted p-3 text-xs text-ink-muted">
                      <span className="font-medium text-ink">{span.text}</span>
                      <span className="mt-1 block">
                        {sourceSummary(span.derived_from_candidate_ids)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {planningFinal.omitted_strong_candidate_reasons.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  {messages.results.omittedStrongCandidates}
                </h3>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-muted">
                  {planningFinal.omitted_strong_candidate_reasons.map((omission) => (
                    <li key={omission.candidate_id}>
                      <code>{omission.candidate_id}</code>：{omission.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold text-ink">
                {messages.results.topicLedgers}
              </h3>
              <div className="mt-2 flex flex-col gap-2">
                {topics.map((topic) => (
                  <TopicTrace
                    key={topic.topic.topic_id}
                    topic={topic}
                    result={result}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

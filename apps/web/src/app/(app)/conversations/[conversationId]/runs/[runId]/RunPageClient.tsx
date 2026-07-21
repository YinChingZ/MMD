"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy } from "lucide-react";
import { toast } from "sonner";
import type { Phase } from "@mmd/protocol";
import { getRunImages, getRunResult, type RunResult } from "@/lib/api";
import { messages } from "@/lib/messages";
import { deriveRunProgress, phaseListForMode } from "@/lib/progress";
import { ROOT_COMPOSE_KEY } from "@/lib/run-events";
import { useRunEvents } from "@/hooks/useRunEvents";
import { useRunStatus } from "@/hooks/useRunStatus";
import { ErrorPanel } from "@/components/ErrorPanel";
import { ImageThumbnails } from "@/components/ImageThumbnails";
import { RunResultView } from "@/components/RunResultView";
import { RunStatusBadge } from "@/components/RunStatusBadge";
import { ShareButton } from "@/components/ShareButton";
import { IconButton } from "@/components/ui/icon-button";
import { ConsensusSummary } from "@/components/results/ConsensusSection";
import { ActivityStream } from "@/components/run/ActivityStream";
import { ProtocolTimeline } from "@/components/run/ProtocolTimeline";
import { StreamingAnswer } from "@/components/run/StreamingAnswer";
import { GovernanceBadge } from "@/components/run/GovernanceBadge";
import {
  PlanningSummary,
  TopicProgress,
} from "@/components/run/TopicProgress";
import { ContextPanel } from "@/components/shell/ContextPanel";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function RunPageClient({ runId }: { runId: string }) {
  // SSE 与轮询兜底只在此处挂载一次；子组件仅接收派生 props（防回归约束）。
  const { run, loading } = useRunStatus(runId);
  const isRunning = run?.status === "running";
  const { events, composeText } = useRunEvents(runId, isRunning);
  const progress = useMemo(
    () => (run ? deriveRunProgress(events, run.mode) : null),
    [events, run],
  );
  // 运行中/失败态下，ActivityStream 与 ProtocolTimeline 联动的当前阶段选择。
  const [selectedPhase, setSelectedPhase] = useState<Phase | undefined>(
    undefined,
  );

  const [result, setResult] = useState<RunResult | null>(null);
  useEffect(() => {
    if (run?.status !== "completed") return;
    let cancelled = false;
    getRunResult(runId).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [run?.status, runId]);

  const [images, setImages] = useState<{ dataUrl: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    getRunImages(runId).then((fetched) => {
      if (!cancelled) setImages(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (loading || !run) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-8">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const failedPhase =
    run.status === "failed" && progress?.kind === "flat"
      ? (Object.entries(progress.phases).find(
          ([, s]) => s === "failed",
        )?.[0] as Phase | undefined)
      : undefined;
  const phaseLabelFor = (phase: Phase) =>
    run.mode === "standard" &&
    run.governance === "distributed" &&
    phase === "normalize"
      ? messages.run.peerAlign
      : (messages.run.phases[phase] ?? phase);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
      {/* 头部：返回 + 问题 + 状态 */}
      <header className="flex flex-col gap-2">
        <Link
          href={`/conversations/${run.conversationId}`}
          className="inline-flex w-fit items-center gap-1 text-xs text-ink-faint transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3 w-3" />
          {messages.shell.conversations}
        </Link>
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-xl font-semibold leading-snug text-ink">
            {run.question}
          </h1>
          <IconButton
            size="sm"
            label={messages.results.copyQuestion}
            onClick={async () => {
              await navigator.clipboard.writeText(run.question);
              toast.success(messages.common.copied);
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <ImageThumbnails images={images} />
        <div className="flex items-center gap-2" aria-live="polite">
          <RunStatusBadge status={run.status} />
          <Badge tone="neutral">
            {messages.modes[run.mode]?.name ?? run.mode}
          </Badge>
          <GovernanceBadge mode={run.mode} governance={run.governance} />
          {run.status === "completed" && <ShareButton runId={runId} />}
        </div>
      </header>

      {/* 运行中 / 失败——失败态下继续显示已产出的内容，而非清空 */}
      {(run.status === "running" || run.status === "failed") && progress && (
        <>
          {progress.kind === "flat" ? (
            <div className="flex flex-col gap-4">
              <ActivityStream
                itemProgress={progress.itemProgress}
                phases={progress.phases}
                phaseOrder={phaseListForMode(run.mode)}
                selectedPhase={selectedPhase}
                onSelectPhase={setSelectedPhase}
                phaseLabelFor={phaseLabelFor}
              />
              {progress.phases.compose === "in_progress" && (
                <StreamingAnswer text={composeText[ROOT_COMPOSE_KEY] ?? ""} />
              )}
            </div>
          ) : (
            <TopicProgress progress={progress} composeText={composeText} />
          )}

          <ContextPanel title={messages.run.protocolTitle}>
            {progress.kind === "flat" ? (
              <ProtocolTimeline
                phases={phaseListForMode(run.mode)}
                statusFor={(phase) => progress.phases[phase] ?? "pending"}
                modelProgressFor={(phase) => progress.modelProgress[phase]}
                selectedPhase={selectedPhase}
                onSelectPhase={setSelectedPhase}
                phaseLabelFor={phaseLabelFor}
              />
            ) : (
              <PlanningSummary progress={progress} />
            )}
          </ContextPanel>
        </>
      )}

      {/* 失败：错误说明 + 重试入口，出现在已产出内容下方 */}
      {run.status === "failed" && (
        <ErrorPanel
          error={run.error}
          failedPhase={failedPhase}
          retryHref={`/conversations/${run.conversationId}?retry=${runId}`}
        />
      )}

      {/* 已完成 */}
      {run.status === "completed" && result && (
        <>
          <RunResultView result={result} />
          <ContextPanel
            title={
              result.planningFinal
                ? messages.results.planningTrace
                : result.planDocument
                ? messages.results.tableOfContents
                : messages.results.consensusTitle
            }
          >
            {result.planningFinal ? (
              <div className="flex flex-col gap-2 text-sm text-ink-muted">
                <p>{messages.results.planningTraceHint(
                  result.topics?.length ?? 0,
                  result.planningFinal.spans.length,
                )}</p>
                <p>{messages.results.coordinatorSynthesis}：{
                  result.planningFinal.spans.filter(
                    (span) => span.lineage_kind === "coordinator_synthesis",
                  ).length
                }</p>
              </div>
            ) : result.planDocument ? (
              <ol className="flex flex-col gap-1.5">
                {result.planDocument.sections.map((section, i) => (
                  <li key={section.topic_id}>
                    <a
                      href={`#section-${section.topic_id}`}
                      className="text-sm text-ink-muted transition-colors hover:text-accent"
                    >
                      {i + 1}. {section.title}
                    </a>
                  </li>
                ))}
              </ol>
            ) : (
              <ConsensusSummary
                candidates={result.normalize.candidate_claims}
                classifications={result.classifications}
              />
            )}
          </ContextPanel>
        </>
      )}
    </div>
  );
}

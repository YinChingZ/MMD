"use client";

import { useEffect, useMemo, useState } from "react";
import { getRunResult, type RunResult } from "@/lib/api";
import { deriveRunProgress } from "@/lib/progress";
import { ROOT_COMPOSE_KEY } from "@/lib/run-events";
import { useRunEvents } from "@/hooks/useRunEvents";
import { useRunStatus } from "@/hooks/useRunStatus";
import { ErrorPanel } from "@/components/ErrorPanel";
import { FinalAnswerPanel } from "@/components/FinalAnswerPanel";
import { LivePhaseItems } from "@/components/LivePhaseItems";
import { PhaseProgress } from "@/components/PhaseProgress";
import { PlanningPhaseProgress } from "@/components/PlanningPhaseProgress";
import { RunResultView } from "@/components/RunResultView";
import { RunStatusBadge } from "@/components/RunStatusBadge";
import { ShareButton } from "@/components/ShareButton";

export function RunPageClient({ runId }: { runId: string }) {
  const { run, loading } = useRunStatus(runId);
  const isRunning = run?.status === "running";
  const { events, composeText } = useRunEvents(runId, isRunning);
  const progress = useMemo(
    () => (run ? deriveRunProgress(events, run.mode) : null),
    [events, run]
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

  if (loading || !run) {
    return <p className="text-sm text-gray-500">Loading run…</p>;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <RunStatusBadge status={run.status} />
          <span className="text-xs text-gray-400">mode: {run.mode}</span>
        </div>
        <h1 className="text-lg font-semibold">{run.question}</h1>
      </div>

      {run.status === "running" && progress && (
        <div className="rounded border border-gray-200 p-4">
          {progress.kind === "flat" ? (
            <>
              <PhaseProgress mode={run.mode} progress={progress} />
              <div className="mt-3">
                <LivePhaseItems itemProgress={progress.itemProgress} phases={progress.phases} />
              </div>
              {progress.phases.compose === "in_progress" && (
                <div className="mt-3">
                  <FinalAnswerPanel
                    title="Final answer (typing…)"
                    text={composeText[ROOT_COMPOSE_KEY] ?? ""}
                  />
                </div>
              )}
            </>
          ) : (
            <PlanningPhaseProgress progress={progress} composeText={composeText} />
          )}
        </div>
      )}

      {run.status === "failed" && <ErrorPanel error={run.error} />}

      {run.status === "completed" && result && (
        <>
          <ShareButton runId={runId} />
          <RunResultView result={result} />
        </>
      )}
    </div>
  );
}

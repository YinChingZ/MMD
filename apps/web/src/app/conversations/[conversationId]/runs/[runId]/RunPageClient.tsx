"use client";

import { useEffect, useMemo, useState } from "react";
import { getRunResult, type RunResult } from "@/lib/api";
import { formatRunCost } from "@/lib/cost";
import { deriveRunProgress } from "@/lib/progress";
import { useRunEvents } from "@/hooks/useRunEvents";
import { useRunStatus } from "@/hooks/useRunStatus";
import { ConsensusPanel } from "@/components/ConsensusPanel";
import { DiscussionProcess } from "@/components/DiscussionProcess";
import { ErrorPanel } from "@/components/ErrorPanel";
import { FinalAnswerPanel } from "@/components/FinalAnswerPanel";
import { PhaseProgress } from "@/components/PhaseProgress";
import { PlanDocumentView } from "@/components/PlanDocumentView";
import { PlanningPhaseProgress } from "@/components/PlanningPhaseProgress";
import { RunStatusBadge } from "@/components/RunStatusBadge";

export function RunPageClient({ runId }: { runId: string }) {
  const { run, loading } = useRunStatus(runId);
  const isRunning = run?.status === "running";
  const events = useRunEvents(runId, isRunning);
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
            <PhaseProgress mode={run.mode} progress={progress} />
          ) : (
            <PlanningPhaseProgress progress={progress} />
          )}
        </div>
      )}

      {run.status === "failed" && <ErrorPanel error={run.error} />}

      {run.status === "completed" && result && (
        <>
          {result.cost && (
            <p className="text-sm text-gray-500">{formatRunCost(result.cost)}</p>
          )}
          {result.planDocument ? (
            <PlanDocumentView planDocument={result.planDocument} topics={result.topics ?? []} />
          ) : (
            <>
              <FinalAnswerPanel text={result.final.final_answer} />
              <ConsensusPanel
                candidates={result.normalize.candidate_claims}
                classifications={result.classifications}
                proposals={result.proposals}
                revisions={result.revisions}
              />
              <DiscussionProcess
                proposals={result.proposals}
                critiques={result.critiques}
                revisions={result.revisions}
                votes={result.votes}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

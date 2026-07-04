"use client";

import { useEffect, useState } from "react";
import { getRun, type RunRow } from "@/lib/api";

const POLL_INTERVAL_MS = 5000;

/**
 * Polls GET /api/runs/:id as the source of truth for terminal status,
 * independent of the SSE stream. This is a deliberate safety net, not
 * redundant with useRunEvents: planning mode's "all topics failed" path
 * (packages/orchestrator/src/index.ts's runPlanningDeliberation throws
 * before emitting any run_failed event when topics.length === 0) leaves the
 * SSE stream open with no terminal frame ever arriving — polling status
 * directly means the UI still resolves instead of hanging indefinitely.
 */
export function useRunStatus(runId: string) {
  const [run, setRun] = useState<RunRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      try {
        const row = await getRun(runId);
        if (cancelled) return;
        setRun(row);
        setLoading(false);
        if (row.status !== "running" && timer) clearInterval(timer);
      } catch {
        // transient fetch error — next tick retries
      }
    };

    poll();
    timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [runId]);

  return { run, loading };
}

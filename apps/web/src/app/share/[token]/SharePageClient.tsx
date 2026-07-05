"use client";

import { useEffect, useState } from "react";
import { getSharedRun, type RunResult } from "@/lib/api";
import { RunResultView } from "@/components/RunResultView";
import { RunStatusBadge } from "@/components/RunStatusBadge";

/**
 * No workspace cookie, no auth, no polling/SSE — a shared link only ever
 * points at an already-completed run (see apps/api/src/routes/share.ts), so
 * there's no "in progress" state to watch here, unlike RunPageClient.
 */
export function SharePageClient({ token }: { token: string }) {
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSharedRun(token)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <p className="text-sm text-gray-500">
        This shared link is invalid or has been revoked.
      </p>
    );
  }

  if (!result) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <RunStatusBadge status="completed" />
          <span className="text-xs text-gray-400">mode: {result.mode}</span>
        </div>
        <h1 className="text-lg font-semibold">{result.question}</h1>
      </div>
      <RunResultView result={result} />
    </div>
  );
}

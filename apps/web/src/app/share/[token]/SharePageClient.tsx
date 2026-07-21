"use client";

import { useEffect, useState } from "react";
import { getSharedRun, type RunResult } from "@/lib/api";
import { messages } from "@/lib/messages";
import { BrandMark } from "@/components/BrandMark";
import { RunResultView } from "@/components/RunResultView";
import { RunStatusBadge } from "@/components/RunStatusBadge";
import { Badge } from "@/components/ui/badge";
import { GovernanceBadge } from "@/components/run/GovernanceBadge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * No workspace cookie, no auth, no polling/SSE — a shared link only ever
 * points at an already-completed run (see apps/api/src/routes/share.ts), so
 * there's no "in progress" state to watch here, unlike RunPageClient.
 * 页面保持无工作区 chrome：极简品牌页头 + 阅读组件 + 页脚。
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

  return (
    <div className="min-h-screen bg-background">
      {/* 品牌页头（无任何工作区操作） */}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-12 max-w-3xl items-center gap-2.5 px-6">
          <BrandMark />
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            {messages.common.appName}
          </span>
          <span className="text-xs text-ink-faint">
            {messages.common.appTagline}
          </span>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-8">
        {error && (
          <p className="pt-8 text-center text-sm text-ink-muted">
            {messages.share.notFound}
          </p>
        )}

        {!error && !result && (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {result && (
          <>
            <header className="flex flex-col gap-2">
              <h1 className="text-xl font-semibold leading-snug text-ink">
                {result.question}
              </h1>
              <div className="flex items-center gap-2">
                <RunStatusBadge status="completed" />
                <Badge tone="neutral">
                  {messages.modes[result.mode]?.name ?? result.mode}
                </Badge>
                <GovernanceBadge
                  mode={result.mode}
                  governance={result.governance}
                />
                <span className="text-xs text-ink-faint">
                  {messages.share.deliberatedBy(
                    result.proposals.length ||
                      (result.topics?.[0]?.proposals.length ?? 0),
                  )}
                </span>
              </div>
            </header>
            <RunResultView result={result} />
          </>
        )}
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-ink-faint">
        {messages.share.whatIsMmd}{" "}
        <span className="text-ink-muted">
          {messages.home.heading}
        </span>
      </footer>
    </div>
  );
}

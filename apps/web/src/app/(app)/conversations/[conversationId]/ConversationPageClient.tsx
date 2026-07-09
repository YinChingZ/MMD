"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import {
  createRun,
  getConversation,
  type ConversationSummary,
  type RunRow,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { messages } from "@/lib/messages";
import { buildCreateRunPayload } from "@/lib/model-sources";
import { parseOutputSchema } from "@/lib/output-schema";
import { AdvancedRunSettings } from "@/components/composer/AdvancedRunSettings";
import { DecisionComposer } from "@/components/composer/DecisionComposer";
import { useRunConfig } from "@/components/composer/useRunConfig";
import { RunStatusBadge } from "@/components/RunStatusBadge";
import { ContextPanel } from "@/components/shell/ContextPanel";
import { PREFILL_KEY } from "@/components/shell/HomeHero";
import { Skeleton } from "@/components/ui/skeleton";

export function ConversationPageClient({
  conversationId,
}: {
  conversationId: string;
}) {
  const router = useRouter();
  const config = useRunConfig();
  const [conversation, setConversation] = useState<
    (ConversationSummary & { runs: RunRow[] }) | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  const [prefill, setPrefill] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    getConversation(conversationId).then((c) => {
      if (!cancelled) setConversation(c);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // 首页示例 chip / 首页输入带过来的问题
  useEffect(() => {
    const stored = sessionStorage.getItem(PREFILL_KEY);
    if (stored) {
      sessionStorage.removeItem(PREFILL_KEY);
      setPrefill(stored);
    }
  }, []);

  const submit = async (question: string) => {
    const parsed = parseOutputSchema(config.outputSchemaText);
    if (!parsed.ok) {
      toast.error(`${messages.jsonOutput.invalid}：${parsed.error}`);
      return;
    }
    setSubmitting(true);
    try {
      const { runId } = await createRun(
        conversationId,
        buildCreateRunPayload({
          question,
          mode: config.mode,
          modelIds: config.modelIds,
          byokEntries: config.byokEntries,
          costLimitUsd: config.costLimitUsd,
          outputFormat: parsed.outputFormat,
          images: config.images.map(({ dataUrl }) => ({ dataUrl })),
          webSearch: config.webSearch,
        }),
      );
      router.push(`/conversations/${conversationId}/runs/${runId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : messages.errors.generic);
      setSubmitting(false);
    }
  };

  // 旧→新排列，形成自上而下的决策时间线
  const runs = conversation
    ? [...conversation.runs].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )
    : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-border bg-background/80 px-6 backdrop-blur">
        <h1 className="truncate text-sm font-medium text-ink">
          {conversation?.title || messages.shell.untitled}
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
          {runs === null && (
            <div className="flex flex-col gap-4">
              <Skeleton className="ml-auto h-16 w-2/3" />
              <Skeleton className="h-24 w-3/4" />
            </div>
          )}
          {runs?.length === 0 && (
            <p className="pt-16 text-center text-sm text-ink-faint">
              {messages.shell.emptyConversation}
            </p>
          )}
          {runs?.map((run) => <RunTimelineItem key={run.id} run={run} />)}
        </div>
      </div>

      <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent px-6 pb-5 pt-2">
        <div className="mx-auto max-w-3xl">
          <DecisionComposer
            config={config}
            onSubmit={submit}
            submitting={submitting}
            initialQuestion={prefill}
            placeholder={
              runs?.length
                ? messages.composer.placeholderContinue
                : messages.composer.placeholder
            }
            autoFocus
          />
        </div>
      </div>

      <ContextPanel title={messages.composer.advancedSettings}>
        <AdvancedRunSettings config={config} />
      </ContextPanel>
    </div>
  );
}

function RunTimelineItem({ run }: { run: RunRow }) {
  return (
    <article className="flex flex-col gap-2">
      {/* 用户问题（右对齐气泡） */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-accent-muted px-4 py-2.5">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
            {run.question}
          </p>
        </div>
      </div>

      {/* 运行卡（左对齐） */}
      <div className="flex justify-start">
        <Link
          href={`/conversations/${run.conversationId}/runs/${run.id}`}
          className="group max-w-[85%] rounded-lg border border-border bg-surface px-4 py-3 shadow-card transition-colors hover:border-border-strong"
        >
          <div className="flex items-center gap-2">
            <RunStatusBadge status={run.status} />
            <span className="text-xs text-ink-faint">
              {messages.modes[run.mode]?.name ?? run.mode} ·{" "}
              {formatRelativeTime(run.createdAt)}
            </span>
          </div>
          {run.status === "failed" && run.error && (
            <p className="mt-2 line-clamp-2 text-sm text-danger">{run.error}</p>
          )}
          <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent">
            {messages.run.viewRun}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      </div>
    </article>
  );
}

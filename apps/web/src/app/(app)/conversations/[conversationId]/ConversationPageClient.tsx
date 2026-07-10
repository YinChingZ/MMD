"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, Copy, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  createRun,
  getConversation,
  getRunImages,
  renameConversation,
  type ConversationSummary,
  type RunRow,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { messages } from "@/lib/messages";
import { buildCreateRunPayload } from "@/lib/model-sources";
import { parseOutputSchema } from "@/lib/output-schema";
import {
  buildRetrySnapshot,
  consumeRetrySnapshot,
  saveRetrySnapshot,
  type RetrySnapshot,
} from "@/lib/retry-snapshot";
import {
  notifyConversationsChanged,
  onConversationsChanged,
} from "@/lib/workspace-events";
import { AdvancedRunSettings } from "@/components/composer/AdvancedRunSettings";
import { DecisionComposer } from "@/components/composer/DecisionComposer";
import { useRunConfig } from "@/components/composer/useRunConfig";
import { ImageThumbnails } from "@/components/ImageThumbnails";
import { RunStatusBadge } from "@/components/RunStatusBadge";
import { ContextPanel } from "@/components/shell/ContextPanel";
import { PREFILL_KEY } from "@/components/shell/HomeHero";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export function ConversationPageClient({
  conversationId,
}: {
  conversationId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const config = useRunConfig();
  const [conversation, setConversation] = useState<
    (ConversationSummary & { runs: RunRow[] }) | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  const [prefill, setPrefill] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getConversation(conversationId).then((c) => {
        if (!cancelled) setConversation(c);
      });
    load();
    // 侧边栏重命名/删除等操作与本页是各自独立的 fetch，靠这个事件总线
    // 同步——否则在会话页里重命名侧边栏能看到，但反过来（侧边栏重命名）
    // 本页标题不会更新，除非刷新。
    const unsubscribe = onConversationsChanged(load);
    return () => {
      cancelled = true;
      unsubscribe();
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

  // 失败重试：从 ?retry=<runId> 回填上次的问题与配置，不自动发送。
  // 拆成两步：读取在挂载时立刻发生（sessionStorage 一次性消费，且要尽快清掉
  // URL 上的 query），但应用到 config 必须等 useRunConfig 自己的默认选择
  // effect（等 models/savedKeys 加载完才 setModelIds）跑完之后，否则默认
  // 选择会在 retry 填完之后再次覆盖它。
  const [retrySnapshot, setRetrySnapshot] = useState<RetrySnapshot | null>(
    null,
  );
  useEffect(() => {
    const retryRunId = searchParams.get("retry");
    if (!retryRunId) return;
    const snapshot = consumeRetrySnapshot(retryRunId);
    router.replace(`/conversations/${conversationId}`);
    if (snapshot) setRetrySnapshot(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const retryAppliedRef = useRef(false);
  useEffect(() => {
    if (
      !retrySnapshot ||
      retryAppliedRef.current ||
      config.models === null ||
      config.savedKeys === null
    ) {
      return;
    }
    retryAppliedRef.current = true;
    config.setMode(retrySnapshot.mode);
    config.setModelIds(
      retrySnapshot.modelIds.filter((id) => config.models?.some((model) => model.id === id)),
    );
    config.setCostLimitUsd(retrySnapshot.costLimitUsd);
    config.setOutputSchemaText(retrySnapshot.outputSchemaText);
    config.setWebSearch(retrySnapshot.webSearch);
    const availableSavedKeyIds = new Set(config.savedKeys.map((key) => key.id));
    const missingSavedLabels = retrySnapshot.byokEntries
      .filter(
        (entry) =>
          "savedKeyId" in entry.payload &&
          !availableSavedKeyIds.has(entry.payload.savedKeyId),
      )
      .map((entry) => entry.label);
    const restoredEntries = retrySnapshot.byokEntries
      .filter(
        (entry) =>
          "savedKeyId" in entry.payload &&
          availableSavedKeyIds.has(entry.payload.savedKeyId),
      )
      .map((entry) => ({ ...entry, clientId: crypto.randomUUID() }));
    config.replaceByokEntries(restoredEntries);
    setPrefill(retrySnapshot.question);
    const missingLabels = [
      ...retrySnapshot.droppedByokLabels,
      ...missingSavedLabels,
    ];
    toast.success(
      missingLabels.length
        ? `${messages.errors.retryRestored}${messages.errors.retryKeysNeeded(missingLabels)}`
        : messages.errors.retryRestored,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrySnapshot, config.models]);

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
      saveRetrySnapshot(
        runId,
        buildRetrySnapshot({
          question,
          mode: config.mode,
          modelIds: config.modelIds,
          costLimitUsd: config.costLimitUsd,
          outputSchemaText: config.outputSchemaText,
          webSearch: config.webSearch,
          byokEntries: config.byokEntries,
        }),
      );
      router.push(`/conversations/${conversationId}/runs/${runId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : messages.errors.generic);
      setSubmitting(false);
    }
  };

  // 会话标题：点击进入编辑，回车/失焦保存，Esc 取消。
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const startEditTitle = () => {
    setTitleDraft(conversation?.title ?? "");
    setEditingTitle(true);
  };

  const commitTitle = async () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === conversation?.title) return;
    try {
      const updated = await renameConversation(conversationId, trimmed);
      setConversation((prev) => (prev ? { ...prev, title: updated.title } : prev));
      notifyConversationsChanged();
    } catch {
      toast.error(messages.shell.renameFailed);
    }
  };

  const onTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") setEditingTitle(false);
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
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background/80 px-6 backdrop-blur">
        {editingTitle ? (
          <Input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={onTitleKeyDown}
            maxLength={200}
            className="h-7 max-w-xs text-sm"
          />
        ) : (
          <button
            type="button"
            onClick={startEditTitle}
            className="group flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-surface-hover"
          >
            <h1 className="truncate text-sm font-medium text-ink">
              {conversation?.title || messages.shell.untitled}
            </h1>
            <Pencil className="h-3 w-3 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
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
          {runs?.map((run, index) => (
            <RunTimelineItem key={run.id} run={run} index={index + 1} />
          ))}
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

function RunTimelineItem({ run, index }: { run: RunRow; index: number }) {
  const [images, setImages] = useState<{ dataUrl: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    getRunImages(run.id).then((fetched) => {
      if (!cancelled) setImages(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [run.id]);

  return (
    <article className="overflow-hidden rounded-md border border-border bg-surface shadow-card">
      <div className="flex items-start gap-3 border-b border-border bg-surface-muted/60 px-4 py-3">
        <span className="mt-0.5 font-mono text-[11px] font-semibold text-live">
          {String(index).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap text-[15px] font-medium leading-relaxed text-ink">
            {run.question}
          </p>
          <ImageThumbnails images={images} />
        </div>
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

      <div className="p-3">
        <Link
          href={`/conversations/${run.conversationId}/runs/${run.id}`}
          className="group block rounded-sm px-1 py-1 transition-colors hover:bg-surface-hover"
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

import {
  Check,
  FileText,
  Lightbulb,
  ListTree,
  Merge,
  MessageSquareWarning,
  PenLine,
  Vote,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Phase } from "@mmd/protocol";
import { cn } from "../../lib/cn";
import { messages } from "../../lib/messages";
import type {
  PhaseModelProgress,
  PhaseStatus,
} from "../../lib/progress";
import { ModelChip } from "./ModelChip";

export const PHASE_ICONS: Record<string, LucideIcon> = {
  propose: Lightbulb,
  critique: MessageSquareWarning,
  revise: PenLine,
  normalize: Merge,
  vote: Vote,
  compose: FileText,
  outline: ListTree,
};

/**
 * 右栏协议时间轴：六阶段（或快速模式三阶段）垂直流程，
 * 四态（待执行/进行中/完成/失败）+ 进行中阶段的模型响应进度。
 * 非 pending 的节点可点击，联动中央 ActivityStream 切换查看该阶段的产物。
 */
export function ProtocolTimeline({
  phases,
  statusFor,
  modelProgressFor,
  selectedPhase,
  onSelectPhase,
}: {
  phases: Phase[];
  statusFor: (phase: Phase) => PhaseStatus;
  modelProgressFor?: (phase: Phase) => PhaseModelProgress | undefined;
  selectedPhase?: Phase;
  onSelectPhase?: (phase: Phase) => void;
}) {
  return (
    <ol className="flex flex-col">
      {phases.map((phase, i) => {
        const status = statusFor(phase);
        const progress = modelProgressFor?.(phase);
        const Icon = PHASE_ICONS[phase] ?? FileText;
        const isLast = i === phases.length - 1;
        const clickable = Boolean(onSelectPhase) && status !== "pending";
        return (
          <li key={phase} className="relative flex gap-3 pb-1">
            {/* 连接线 */}
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px",
                  status === "done" ? "bg-consensus-strong/40" : "bg-border",
                )}
              />
            )}
            {/* 阶段图标节点 */}
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onSelectPhase?.(phase)}
              aria-label={messages.run.phases[phase] ?? phase}
              className={cn(
                "z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-shadow",
                clickable && "cursor-pointer hover:opacity-80",
                !clickable && "cursor-default",
                phase === selectedPhase &&
                  "ring-2 ring-accent ring-offset-2 ring-offset-surface",
                status === "pending" && "border-border bg-surface text-ink-faint",
                status === "in_progress" &&
                  "border-live/50 bg-live-muted text-live",
                status === "done" &&
                  "border-consensus-strong/40 bg-consensus-strong-bg text-consensus-strong",
                status === "failed" && "border-danger/50 bg-danger-muted text-danger",
              )}
            >
              {status === "done" ? (
                <Check className="h-4 w-4" />
              ) : status === "failed" ? (
                <X className="h-4 w-4" />
              ) : (
                <Icon className={cn("h-4 w-4", status === "in_progress" && "mmd-pulse")} />
              )}
            </button>

            <div className="min-w-0 flex-1 pb-3 pt-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-sm font-medium",
                    status === "pending" ? "text-ink-faint" : "text-ink",
                  )}
                >
                  {messages.run.phases[phase] ?? phase}
                </span>
                {status === "in_progress" && progress && progress.total > 0 && (
                  <span className="text-xs text-ink-faint">
                    {messages.run.phaseResponded(
                      progress.responded.length,
                      progress.total,
                    )}
                  </span>
                )}
              </div>
              {status === "in_progress" && Boolean(progress?.retrying?.length) && (
                <p className="mt-1 text-xs text-live">
                  {progress!.retrying!.join("、")} 已切换稳定模式重试
                </p>
              )}

              {/* 进行中：进度条 + 模型芯片 */}
              {status === "in_progress" && progress && progress.total > 0 && (
                <>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className="h-full rounded-full bg-live transition-[width] duration-500"
                      style={{
                        width: `${Math.round(
                          (progress.responded.length / progress.total) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {progress.responded.map((r) => (
                      <ModelChip
                        key={r.modelId}
                        modelId={r.modelId}
                        state={r.ok ? "ok" : "failed"}
                        size="sm"
                      />
                    ))}
                    {Array.from({
                      length: Math.max(0, progress.total - progress.responded.length),
                    }).map((_, idx) => (
                      <span
                        key={idx}
                        aria-hidden
                        className="mmd-pulse h-5 w-5 rounded-full bg-surface-muted ring-2 ring-live/30"
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

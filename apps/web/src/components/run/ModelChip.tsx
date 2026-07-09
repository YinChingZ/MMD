import { cn } from "../../lib/cn";
import {
  modelColor,
  modelDisplayName,
  modelInitials,
} from "../../lib/model-colors";

export type ModelChipState = "generating" | "ok" | "failed" | "idle";

/**
 * 模型头像芯片：确定性配色 + 缩写。状态环：
 * 脉冲 = 生成中，实心 = 已响应，红 = 失败。
 */
export function ModelChip({
  modelId,
  state = "idle",
  showName = false,
  size = "md",
}: {
  modelId: string;
  state?: ModelChipState;
  showName?: boolean;
  size?: "sm" | "md";
}) {
  const color = modelColor(modelId);
  const name = modelDisplayName(modelId);
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5"
      title={`${modelId}${state === "failed" ? "（失败）" : ""}`}
    >
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full font-semibold",
          size === "sm" ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]",
          state === "generating" && "mmd-pulse ring-2 ring-accent/50",
          state === "ok" && "ring-2 ring-consensus-strong/40",
          state === "failed" && "ring-2 ring-danger/60 opacity-70",
        )}
        style={{ backgroundColor: color.bg, color: color.fg }}
      >
        {modelInitials(modelId)}
      </span>
      {showName && (
        <span
          className={cn(
            "truncate text-xs",
            state === "failed" ? "text-danger" : "text-ink-muted",
          )}
        >
          {name}
        </span>
      )}
    </span>
  );
}

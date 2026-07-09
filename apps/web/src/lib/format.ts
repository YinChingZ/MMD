/** 时间显示与侧栏时间分组（中文文案在 messages.ts，这里返回稳定 key）。 */

export type DateGroupKey = "today" | "yesterday" | "week" | "earlier";

export function dateGroupKey(iso: string, now: Date = new Date()): DateGroupKey {
  const date = new Date(iso);
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((startOfDay(now) - startOfDay(date)) / dayMs);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return "week";
  return "earlier";
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((now.getTime() - then) / 1000);
  const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return rtf.format(-Math.floor(diffSec / 60), "minute");
  if (diffSec < 86400) return rtf.format(-Math.floor(diffSec / 3600), "hour");
  if (diffSec < 7 * 86400) return rtf.format(-Math.floor(diffSec / 86400), "day");
  return new Date(iso).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

export function formatCostUsd(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(cost < 1 ? 3 : 2)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return sec > 0 ? `${min} 分 ${sec} 秒` : `${min} 分钟`;
}

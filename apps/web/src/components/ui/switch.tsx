"use client";

import { cn } from "../../lib/cn";

/** 轻量开关：原生 checkbox 语义 + 轨道样式，避免引入额外 Radix 包。 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** 无障碍名称（外部若有可见 label 可传同名文案） */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        checked ? "bg-accent" : "bg-border-strong",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 translate-x-0.5 rounded-full bg-surface shadow-card transition-transform",
          checked && "translate-x-[18px]",
        )}
      />
    </button>
  );
}

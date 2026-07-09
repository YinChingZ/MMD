import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Tone =
  | "neutral"
  | "accent"
  | "strong"
  | "qualified"
  | "disputed"
  | "rejected";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-muted text-ink-muted",
  accent: "bg-accent-muted text-accent",
  strong: "bg-consensus-strong-bg text-consensus-strong",
  qualified: "bg-consensus-qualified-bg text-consensus-qualified",
  disputed: "bg-consensus-disputed-bg text-consensus-disputed",
  rejected: "bg-consensus-rejected-bg text-consensus-rejected",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

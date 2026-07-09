import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("mmd-pulse rounded-sm bg-surface-muted", className)}
      {...props}
    />
  );
}

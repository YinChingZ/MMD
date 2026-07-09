"use client";

import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 4, ...props }, ref) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "mmd-enter z-50 min-w-36 rounded-md border border-border bg-surface p-1 shadow-raised",
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
});

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & {
    tone?: "default" | "danger";
  }
>(function DropdownMenuItem({ className, tone = "default", ...props }, ref) {
  return (
    <DropdownPrimitive.Item
      ref={ref}
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm outline-none",
        tone === "danger"
          ? "text-danger data-[highlighted]:bg-danger-muted"
          : "text-ink data-[highlighted]:bg-surface-hover",
        className,
      )}
      {...props}
    />
  );
});

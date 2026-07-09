"use client";

import { AlertTriangle } from "lucide-react";
import { messages } from "@/lib/messages";
import { Button } from "@/components/ui/button";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <AlertTriangle className="h-8 w-8 text-danger" />
      <p className="text-sm text-ink-muted">{messages.errors.generic}</p>
      <Button size="sm" onClick={reset}>
        {messages.common.retry}
      </Button>
    </div>
  );
}

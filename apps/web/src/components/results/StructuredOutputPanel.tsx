"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { messages } from "../../lib/messages";
import { IconButton } from "../ui/icon-button";

/** M6.1「结构化输出」区块：作为结果的附属区块，不抢占主答案。 */
export function StructuredOutputPanel({ userOutput }: { userOutput: unknown }) {
  const pretty = JSON.stringify(userOutput, null, 2);

  const copy = async () => {
    await navigator.clipboard.writeText(pretty);
    toast.success(messages.common.copied);
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">
          {messages.jsonOutput.resultTitle}
        </h3>
        <IconButton size="sm" label={messages.common.copy} onClick={copy}>
          <Copy className="h-4 w-4" />
        </IconButton>
      </div>
      <pre className="mt-2 overflow-x-auto rounded-md bg-surface-muted p-3 font-mono text-xs leading-relaxed text-ink">
        {pretty}
      </pre>
    </section>
  );
}

"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { formatCostUsd } from "../../lib/format";
import { messages } from "../../lib/messages";
import type { RunResult } from "../../lib/api";
import { IconButton } from "../ui/icon-button";
import { Markdown } from "../Markdown";

/** 完成态首屏：答案优先的最终答案卡 + 成本/模式/模型数元信息。 */
export function FinalAnswerCard({
  text,
  result,
  title,
}: {
  text: string;
  result?: RunResult;
  title?: string;
}) {
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    toast.success(messages.results.answerCopied);
  };

  const modelCount = result?.proposals.length;

  return (
    <section
      id="final-answer"
      className="rounded-lg border border-border bg-surface p-6 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">
          {title ?? messages.results.finalAnswer}
        </h2>
        <IconButton size="sm" label={messages.results.copyAnswer} onClick={copy}>
          <Copy className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="mt-3 leading-relaxed">
        <Markdown text={text} />
      </div>
      {result && (
        <p className="mt-4 border-t border-border pt-3 text-xs text-ink-faint">
          {[
            result.cost &&
              `${messages.run.cost} ${formatCostUsd(result.cost.totalUsd)}${result.cost.hasUnknownPricing ? "+" : ""}`,
            `${messages.run.mode} ${messages.modes[result.mode]?.name ?? result.mode}`,
            modelCount ? messages.run.modelCount(modelCount) : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </section>
  );
}

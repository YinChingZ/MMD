"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { createConversation, createRun } from "../../lib/api";
import { messages } from "../../lib/messages";
import { buildCreateRunPayload } from "../../lib/model-sources";
import { parseOutputSchema } from "../../lib/output-schema";
import { runCreationErrorMessage } from "../../lib/run-errors";
import { buildRetrySnapshot, saveRetrySnapshot } from "../../lib/retry-snapshot";
import { notifyConversationsChanged } from "../../lib/workspace-events";
import { AdvancedRunSettings } from "../composer/AdvancedRunSettings";
import { DecisionComposer } from "../composer/DecisionComposer";
import { useRunConfig } from "../composer/useRunConfig";
import { ContextPanel } from "./ContextPanel";

/** 跨页首问预填：会话页输入器在挂载时读取并清除。 */
export const PREFILL_KEY = "mmd.prefill-question";

export function HomeHero() {
  const router = useRouter();
  const config = useRunConfig();
  const [submitting, setSubmitting] = useState(false);
  const [prefill, setPrefill] = useState<string>();

  // 首页直接发起：先建会话，再建 run，落到运行页。
  const submit = async (question: string) => {
    const parsed = parseOutputSchema(config.outputSchemaText);
    if (!parsed.ok) {
      toast.error(`${messages.jsonOutput.invalid}：${parsed.error}`);
      return;
    }
    setSubmitting(true);
    try {
      const conversation = await createConversation();
      notifyConversationsChanged();
      const { runId } = await createRun(
        conversation.id,
        buildCreateRunPayload({
          question,
          mode: config.mode,
          governance: config.governance,
          modelIds: config.modelIds,
          byokEntries: config.byokEntries,
          costLimitUsd: config.costLimitUsd,
          outputFormat: parsed.outputFormat,
          images: config.images.map(({ dataUrl }) => ({ dataUrl })),
          webSearch: config.webSearch,
        }),
      );
      saveRetrySnapshot(
        runId,
        buildRetrySnapshot({
          question,
          mode: config.mode,
          governance: config.governance,
          modelIds: config.modelIds,
          costLimitUsd: config.costLimitUsd,
          outputSchemaText: config.outputSchemaText,
          webSearch: config.webSearch,
          byokEntries: config.byokEntries,
        }),
      );
      router.push(`/conversations/${conversation.id}/runs/${runId}`);
    } catch (err) {
      toast.error(runCreationErrorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-full px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
      <div className="mx-auto w-full max-w-5xl">
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] font-semibold tracking-[0.16em] text-accent">
            {messages.home.eyebrow}
          </p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
            {messages.home.heading}
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-muted">
            {messages.home.subheading}
          </p>
        </div>

        <div className="mt-8 max-w-3xl">
          <DecisionComposer
            config={config}
            onSubmit={submit}
            submitting={submitting}
            initialQuestion={prefill}
            autoFocus
          />
        </div>

        <ol className="mt-8 grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
          {messages.home.protocol.map((item) => (
            <li key={item.step} className="bg-surface p-4">
              <span className="font-mono text-[11px] font-semibold text-live">{item.step}</span>
              <p className="mt-2 text-sm font-semibold text-ink">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{item.hint}</p>
            </li>
          ))}
        </ol>

        <div className="mt-8 border-t border-border pt-5">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-faint">{messages.home.examplesLabel}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {messages.home.examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrefill(example)}
                className="rounded-md border border-border bg-surface px-3.5 py-2 text-left text-[13px] text-ink-muted transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ContextPanel title={messages.composer.advancedSettings}>
        <AdvancedRunSettings config={config} />
      </ContextPanel>
    </div>
  );
}

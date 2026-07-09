"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { createConversation, createRun } from "../../lib/api";
import { messages } from "../../lib/messages";
import { buildCreateRunPayload } from "../../lib/model-sources";
import { parseOutputSchema } from "../../lib/output-schema";
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
          modelIds: config.modelIds,
          byokEntries: config.byokEntries,
          costLimitUsd: config.costLimitUsd,
          outputFormat: parsed.outputFormat,
          images: config.images.map(({ dataUrl }) => ({ dataUrl })),
          webSearch: config.webSearch,
        }),
      );
      router.push(`/conversations/${conversation.id}/runs/${runId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : messages.errors.generic);
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <div className="w-full max-w-2xl">
        <div className="text-center">
          <h1 className="text-2xl font-semibold leading-snug tracking-tight text-ink">
            {messages.home.heading}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-ink-muted">
            {messages.home.subheading}
          </p>
        </div>

        <div className="mt-8">
          <DecisionComposer
            config={config}
            onSubmit={submit}
            submitting={submitting}
            initialQuestion={prefill}
            autoFocus
          />
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm text-ink-faint">{messages.home.examplesLabel}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {messages.home.examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrefill(example)}
                className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-[13px] text-ink-muted transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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

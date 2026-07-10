import { OutlineResultSchema } from "@mmd/protocol";
import type { CompletionRequest } from "@mmd/model-adapters";
import { describeSchema } from "./schema-text.js";

export interface BuildOutlinePromptParams {
  question: string;
  maxTopics?: number;
  /** M6.7: the immediately-previous run's question+answer in this conversation, if any. */
  priorContext?: string;
}

export function buildOutlinePrompt(
  params: BuildOutlinePromptParams
): CompletionRequest {
  const { question, maxTopics = 8, priorContext } = params;

  const systemPrompt = [
    "Break the following question/request down into a bounded list of distinct topics to structure a multi-model deliberation around.",
    `Produce at most ${maxTopics} topics.`,
    "Each topic must be a genuinely separate decision area (e.g. for a technical plan: architecture, database, auth, deployment, timeline, risks) — do not split one decision into multiple overlapping topics.",
    "Give each topic a short title and a one-sentence description of its scope, precise enough that a model addressing only that topic knows what is and isn't in scope.",
    "If the question is narrow enough to need only one topic, return exactly one topic covering it.",
    "Return ONLY JSON matching this schema, no prose outside the JSON:",
    describeSchema(OutlineResultSchema, "OutlineResult"),
  ].join("\n\n");

  const userPrompt = [priorContext, `Question: ${question}`]
    .filter(Boolean)
    .join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    meta: { phase: "outline", question, maxTopics },
  };
}

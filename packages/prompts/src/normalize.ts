import { NormalizeResultSchema, type Topic } from "@mmd/protocol";
import type { CompletionRequest } from "@mmd/model-adapters";
import { describeSchema } from "./schema-text.js";

export interface ClaimForNormalize {
  claim_id: string;
  text: string;
  model_id: string;
}

export interface BuildNormalizePromptParams {
  question: string;
  claims: ClaimForNormalize[];
  /** v0.2 planning mode: scope this normalize call to a single outline topic. `claims` should already be filtered to that topic by the caller. */
  topic?: Topic;
}

export function buildNormalizePrompt(
  params: BuildNormalizePromptParams
): CompletionRequest {
  const { question, claims, topic } = params;

  const systemPrompt = [
    "Merge semantically equivalent claims from different models into candidate consensus claims.",
    "You are doing semantic grouping only — do not decide which claim is factually correct, and do not drop a claim's substance to force a merge.",
    "Every candidate claim must list source_claim_ids for every original claim it merges (at least one — never empty).",
    "If a claim doesn't overlap with any other, it still becomes its own candidate with a single source_claim_id.",
    ...(topic
      ? [
          `All claims below are scoped to the topic "${topic.title}" — ${topic.description}.`,
        ]
      : []),
    "Return ONLY JSON matching this schema, no prose outside the JSON:",
    describeSchema(NormalizeResultSchema, "NormalizeResult"),
  ].join("\n\n");

  const userPrompt = [
    `Question: ${question}`,
    "All claims across all models (post-revision):",
    JSON.stringify(claims, null, 2),
  ].join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    meta: {
      phase: "normalize",
      claims,
      ...(topic ? { topicId: topic.topic_id } : {}),
    },
  };
}

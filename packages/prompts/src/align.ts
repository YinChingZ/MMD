import { AlignResultSchema, type Topic } from "@mmd/protocol";
import type { CompletionRequest } from "@mmd/model-adapters";
import { describeSchema } from "./schema-text.js";
import type { ClaimForNormalize } from "./normalize.js";

export function buildAlignPrompt(params: {
  question: string;
  alignerModelId: string;
  claims: ClaimForNormalize[];
  topic?: Topic;
}): CompletionRequest {
  return {
    systemPrompt: [
      "Compare every unordered pair of post-revision claims for semantic alignment.",
      "Use equivalent only when both claims can safely share one candidate without losing substance.",
      "Use conflict and cannot_link whenever merging would hide a substantive disagreement.",
      "Use uncertain rather than guessing. Do not create clusters; the host performs deterministic complete-link clustering.",
      "Return ONLY JSON matching this schema:",
      describeSchema(AlignResultSchema, "AlignResult"),
    ].join("\n\n"),
    userPrompt: [
      `Question: ${params.question}`,
      ...(params.topic
        ? [`Topic: ${params.topic.title} — ${params.topic.description}`]
        : []),
      `Claims: ${JSON.stringify(params.claims, null, 2)}`,
    ].join("\n\n"),
    meta: {
      phase: "align",
      question: params.question,
      alignerModelId: params.alignerModelId,
      claims: params.claims,
      ...(params.topic ? { topicId: params.topic.topic_id } : {}),
    },
  };
}

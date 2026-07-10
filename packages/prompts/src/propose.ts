import { ProposalSchema, type Topic } from "@mmd/protocol";
import type { CompletionRequest, ContentPart } from "@mmd/model-adapters";
import { describeSchema } from "./schema-text.js";

export interface BuildProposePromptParams {
  question: string;
  modelId: string;
  maxClaims?: number;
  /** M6.5: validated inline image data URLs, supplied only to propose. */
  images?: string[];
  /** M6.6: permits one provider-native web search in this call. */
  webSearch?: boolean;
  /** v0.2 planning mode: scope this proposal to a single outline topic. Omit for standard/quick mode. */
  topic?: Topic;
  /** M6.7: the immediately-previous run's question+answer in this conversation, if any. */
  priorContext?: string;
}

export function buildProposePrompt(
  params: BuildProposePromptParams
): CompletionRequest {
  const {
    question,
    modelId,
    maxClaims = 6,
    images = [],
    webSearch = false,
    topic,
    priorContext,
  } = params;

  const systemPrompt = [
    "You are one of several independent models answering a user's question before a multi-model deliberation.",
    "Think independently. Do not try to predict or match what other models might say.",
    `Break your answer into at most ${maxClaims} discrete claims.`,
    "Each claim must be typed as fact, judgment, recommendation, assumption, or risk.",
    "Give each claim a confidence between 0 and 1, a rationale, and any conditions under which it holds.",
    "Do not state uncertain information as if it were settled fact — use the 'assumption' or 'risk' type and a lower confidence instead.",
    ...(webSearch
      ? ["Web search is available for time-sensitive or factual verification. Use it only when it materially improves this independent proposal."]
      : []),
    ...(topic
      ? [
          `Address ONLY the following topic; do not discuss other topics even if relevant: "${topic.title}" — ${topic.description}`,
        ]
      : []),
    "Return ONLY JSON matching this schema, no prose outside the JSON:",
    describeSchema(ProposalSchema, "Proposal"),
  ].join("\n\n");

  const questionText = [
    priorContext,
    topic
      ? `Question: ${question}\n\nTopic: ${topic.title} — ${topic.description}`
      : `Question: ${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const userPrompt: string | ContentPart[] = images.length
    ? [
        { type: "text", text: questionText },
        ...images.map((imageUrl) => ({ type: "image_url" as const, imageUrl })),
      ]
    : questionText;

  return {
    systemPrompt,
    userPrompt,
    ...(webSearch ? { tools: [{ type: "web_search" as const }] } : {}),
    meta: {
      phase: "propose",
      question,
      modelId,
      ...(topic ? { topicId: topic.topic_id } : {}),
    },
  };
}

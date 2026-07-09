import { CritiqueSchema, type Proposal, type Topic } from "@mmd/protocol";
import type { CompletionRequest } from "@mmd/model-adapters";
import { describeSchema } from "./schema-text.js";

export interface BuildCritiquePromptParams {
  question: string;
  reviewerModelId: string;
  proposals: Proposal[];
  /** v0.2 planning mode: scope this critique to a single outline topic. `proposals` should already be filtered to that topic's claims by the caller. */
  topic?: Topic;
  /** M6.6: permits one provider-native web search in this call. */
  webSearch?: boolean;
}

export function buildCritiquePrompt(
  params: BuildCritiquePromptParams
): CompletionRequest {
  const { question, reviewerModelId, proposals, webSearch = false, topic } = params;

  const targets = proposals
    .flatMap((p) =>
      p.claims.map((c) => ({
        claim_id: c.claim_id,
        text: c.text,
        model_id: p.model_id,
      }))
    )
    .filter((t) => t.model_id !== reviewerModelId);

  const systemPrompt = [
    "You are reviewing claims proposed by other independent models in a multi-model deliberation.",
    "For each claim from another model, decide: support, challenge, or refine.",
    "Every challenge must include a concrete reason — do not challenge a claim just because of phrasing or style differences; those should not be marked major or critical.",
    "Rate severity as minor, major, or critical, reflecting how much the claim would change the final answer if the challenge were ignored.",
    "You do not need to review your own claims — they have been excluded from the list below.",
    ...(webSearch
      ? ["Web search is available to verify factual claims. Use it only when verification materially affects your review."]
      : []),
    ...(topic
      ? [
          `All claims below are scoped to the topic "${topic.title}" — ${topic.description}. Keep your review within this topic.`,
        ]
      : []),
    "Return ONLY JSON matching this schema, no prose outside the JSON:",
    describeSchema(CritiqueSchema, "Critique"),
  ].join("\n\n");

  const userPrompt = [
    `Question: ${question}`,
    "Claims to review:",
    JSON.stringify(targets, null, 2),
  ].join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    ...(webSearch ? { tools: [{ type: "web_search" as const }] } : {}),
    meta: {
      phase: "critique",
      reviewerModelId,
      targets,
      ...(topic ? { topicId: topic.topic_id } : {}),
    },
  };
}

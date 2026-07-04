import { SectionAnswerSchema, type Topic } from "@mmd/protocol";
import type { CompletionRequest } from "@mmd/model-adapters";
import { describeSchema } from "./schema-text.js";
import type { PositionChangeInput } from "./compose.js";

export interface BuildSectionComposePromptParams {
  question: string;
  topic: Topic;
  strongConsensus: string[];
  qualifiedConsensus: string[];
  disputed: string[];
  rejected: string[];
  positionChanges: PositionChangeInput[];
}

export function buildSectionComposePrompt(
  params: BuildSectionComposePromptParams
): CompletionRequest {
  const {
    question,
    topic,
    strongConsensus,
    qualifiedConsensus,
    disputed,
    rejected,
    positionChanges,
  } = params;

  const systemPrompt = [
    "You are an editor, not a judge, writing one section of a larger multi-topic plan document.",
    `This section covers only the topic "${topic.title}" — ${topic.description}. Do not discuss other topics.`,
    "You may only use the consensus classification given below — do not introduce new claims and do not resolve disputed points yourself.",
    "strong_consensus items go into the main conclusion for this section.",
    "qualified_consensus items go into a conditional-conclusion part of this section.",
    "disputed_points must be presented as open disagreement/uncertainty, never resolved.",
    "rejected_or_unsupported items must not appear in the main conclusion.",
    "tldr must be exactly one sentence summarizing this section's conclusion — it will be concatenated with other sections' tldr fields to form the document's executive summary, so it must stand alone without referring to \"this section\" or other topics.",
    "Return ONLY JSON matching this schema, no prose outside the JSON:",
    describeSchema(SectionAnswerSchema, "SectionAnswer"),
  ].join("\n\n");

  const userPrompt = [
    `Question: ${question}`,
    `Topic: ${topic.title} — ${topic.description}`,
    `strong_consensus: ${JSON.stringify(strongConsensus)}`,
    `qualified_consensus: ${JSON.stringify(qualifiedConsensus)}`,
    `disputed: ${JSON.stringify(disputed)}`,
    `rejected: ${JSON.stringify(rejected)}`,
    `model_position_changes: ${JSON.stringify(positionChanges)}`,
  ].join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    meta: {
      phase: "section_compose",
      question,
      topicId: topic.topic_id,
      topicTitle: topic.title,
      strongConsensus,
      qualifiedConsensus,
      disputed,
      rejected,
      positionChanges,
    },
  };
}

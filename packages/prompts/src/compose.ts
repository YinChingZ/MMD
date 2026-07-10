import { FinalAnswerSchema } from "@mmd/protocol";
import type { CompletionRequest } from "@mmd/model-adapters";
import { describeSchema } from "./schema-text.js";

export interface PositionChangeInput {
  model_id: string;
  changed_from: string;
  changed_to: string;
  reason: string;
}

export interface BuildComposePromptParams {
  question: string;
  strongConsensus: string[];
  qualifiedConsensus: string[];
  disputed: string[];
  rejected: string[];
  positionChanges: PositionChangeInput[];
  /** M6.7: the immediately-previous run's question+answer in this conversation, if any. */
  priorContext?: string;
}

export function buildComposePrompt(
  params: BuildComposePromptParams
): CompletionRequest {
  const {
    question,
    strongConsensus,
    qualifiedConsensus,
    disputed,
    rejected,
    positionChanges,
    priorContext,
  } = params;

  const systemPrompt = [
    "You are an editor, not a judge. You may only use the consensus classification given below — do not introduce new claims and do not resolve disputed points yourself.",
    "strong_consensus items go into the main conclusion.",
    "qualified_consensus items go into a conditional-conclusion section.",
    "disputed_points must be presented as open disagreement/uncertainty, never resolved.",
    "rejected_or_unsupported items must not appear in the main conclusion.",
    "Return ONLY JSON matching this schema, no prose outside the JSON:",
    describeSchema(FinalAnswerSchema, "FinalAnswer"),
  ].join("\n\n");

  const userPrompt = [
    ...(priorContext ? [priorContext] : []),
    `Question: ${question}`,
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
      phase: "compose",
      question,
      strongConsensus,
      qualifiedConsensus,
      disputed,
      rejected,
      positionChanges,
    },
  };
}

import { ProposalSchema } from "@mmd/protocol";
import type { CompletionRequest } from "@mmd/model-adapters";
import { describeSchema } from "./schema-text.js";

export interface BuildProposePromptParams {
  question: string;
  modelId: string;
  maxClaims?: number;
}

export function buildProposePrompt(
  params: BuildProposePromptParams
): CompletionRequest {
  const { question, modelId, maxClaims = 6 } = params;

  const systemPrompt = [
    "You are one of several independent models answering a user's question before a multi-model deliberation.",
    "Think independently. Do not try to predict or match what other models might say.",
    `Break your answer into at most ${maxClaims} discrete claims.`,
    "Each claim must be typed as fact, judgment, recommendation, assumption, or risk.",
    "Give each claim a confidence between 0 and 1, a rationale, and any conditions under which it holds.",
    "Do not state uncertain information as if it were settled fact — use the 'assumption' or 'risk' type and a lower confidence instead.",
    "Return ONLY JSON matching this schema, no prose outside the JSON:",
    describeSchema(ProposalSchema, "Proposal"),
  ].join("\n\n");

  const userPrompt = `Question: ${question}`;

  return {
    systemPrompt,
    userPrompt,
    meta: { phase: "propose", question, modelId },
  };
}

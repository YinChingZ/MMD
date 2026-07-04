import { RevisionSetSchema, type Claim, type Review } from "@mmd/protocol";
import type { CompletionRequest } from "@mmd/model-adapters";
import { describeSchema } from "./schema-text.js";

export interface ReviewWithReviewer extends Review {
  reviewer_model_id: string;
}

export interface BuildRevisePromptParams {
  question: string;
  modelId: string;
  ownClaims: Claim[];
  reviewsOnMine: ReviewWithReviewer[];
}

export function buildRevisePrompt(
  params: BuildRevisePromptParams
): CompletionRequest {
  const { question, modelId, ownClaims, reviewsOnMine } = params;

  const systemPrompt = [
    "Other models have reviewed your claims from the previous round. Decide, per claim, whether to keep, revise, withdraw, or adopt another model's position.",
    "You must explicitly say whether you were persuaded by a specific review, citing it via influenced_by.",
    "Do not abandon an objection you still believe is important just to reach agreement — disagreement is a legitimate outcome.",
    "Return ONLY JSON matching this schema, no prose outside the JSON:",
    describeSchema(RevisionSetSchema, "RevisionSet"),
  ].join("\n\n");

  const userPrompt = [
    `Question: ${question}`,
    "Your claims from the previous round:",
    JSON.stringify(ownClaims, null, 2),
    "Reviews you received:",
    JSON.stringify(reviewsOnMine, null, 2),
  ].join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    meta: {
      phase: "revise",
      modelId,
      ownClaims: ownClaims.map((c) => ({ claim_id: c.claim_id, text: c.text })),
      reviews: reviewsOnMine.map((r) => ({
        reviewer_model_id: r.reviewer_model_id,
        target_claim_id: r.target_claim_id,
        stance: r.stance,
      })),
    },
  };
}

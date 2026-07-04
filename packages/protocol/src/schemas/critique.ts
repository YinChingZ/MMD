import { z } from "zod";
import { ModelId, Severity, Stance } from "./common.js";

export const ReviewSchema = z.object({
  target_claim_id: z.string().min(1),
  stance: Stance,
  severity: Severity,
  comment: z.string().min(1),
  suggested_revision: z.string().optional(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const CritiqueSchema = z.object({
  reviewer_model_id: ModelId,
  reviews: z.array(ReviewSchema),
});
export type Critique = z.infer<typeof CritiqueSchema>;

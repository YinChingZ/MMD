import { z } from "zod";
import { Confidence, ModelId, RevisionDecision } from "./common.js";

export const RevisionSchema = z.object({
  original_claim_id: z.string().min(1),
  decision: RevisionDecision,
  revised_text: z.string().optional(),
  confidence: Confidence,
  reason_for_change: z.string().min(1),
  influenced_by: z.array(z.string()).default([]),
});
export type Revision = z.infer<typeof RevisionSchema>;

export const RevisionSetSchema = z.object({
  model_id: ModelId,
  revisions: z.array(RevisionSchema),
});
export type RevisionSet = z.infer<typeof RevisionSetSchema>;

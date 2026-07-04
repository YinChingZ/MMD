import { z } from "zod";
import { ClaimType, Confidence, ModelId } from "./common.js";

export const ClaimSchema = z.object({
  claim_id: z.string().min(1),
  text: z.string().min(1),
  type: ClaimType,
  confidence: Confidence,
  rationale: z.string().min(1),
  conditions: z.array(z.string()).default([]),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const ProposalSchema = z.object({
  model_id: ModelId,
  answer_summary: z.string().min(1),
  claims: z.array(ClaimSchema).min(1),
  assumptions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});
export type Proposal = z.infer<typeof ProposalSchema>;

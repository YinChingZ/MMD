import { z } from "zod";

// M0 protocol constraint (risk #2, normalize 阶段不得掩盖裁判权):
// candidate claim 必须能追溯回合并前的原始 claims，source_claim_ids 不允许为空。
export const CandidateClaimSchema = z.object({
  candidate_id: z.string().min(1),
  text: z.string().min(1),
  source_claim_ids: z
    .array(z.string().min(1))
    .min(1, "candidate claim must trace back to at least one source claim"),
  notes: z.string().optional(),
});
export type CandidateClaim = z.infer<typeof CandidateClaimSchema>;

export const NormalizeResultSchema = z.object({
  candidate_claims: z.array(CandidateClaimSchema),
});
export type NormalizeResult = z.infer<typeof NormalizeResultSchema>;

import { z } from "zod";
import { Confidence, ModelId, Severity, VoteChoice } from "./common.js";

// M0 fix: 原设计的 compose 规则依赖 "major/critical object" 来判定 disputed，
// 但投票 schema 本身没有携带 severity。这里显式要求 object 投票必须附带
// objection_severity，否则 classifyCandidate 无法区分 disputed vs rejected。
export const BallotSchema = z
  .object({
    candidate_id: z.string().min(1),
    vote: VoteChoice,
    confidence: Confidence,
    reason: z.string().min(1),
    required_condition: z.string().optional(),
    objection_severity: Severity.optional(),
  })
  .refine((b) => b.vote !== "object" || b.objection_severity !== undefined, {
    message: "object votes must include objection_severity",
    path: ["objection_severity"],
  });
export type Ballot = z.infer<typeof BallotSchema>;

export const VoteSetSchema = z.object({
  model_id: ModelId,
  votes: z.array(BallotSchema),
});
export type VoteSet = z.infer<typeof VoteSetSchema>;

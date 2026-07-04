import { z } from "zod";

export const ClaimType = z.enum([
  "fact",
  "judgment",
  "recommendation",
  "assumption",
  "risk",
]);
export type ClaimType = z.infer<typeof ClaimType>;

export const Stance = z.enum(["support", "challenge", "refine"]);
export type Stance = z.infer<typeof Stance>;

export const Severity = z.enum(["minor", "major", "critical"]);
export type Severity = z.infer<typeof Severity>;

export const RevisionDecision = z.enum([
  "keep",
  "revise",
  "withdraw",
  "adopt_other",
]);
export type RevisionDecision = z.infer<typeof RevisionDecision>;

export const VoteChoice = z.enum([
  "approve",
  "approve_with_conditions",
  "object",
  "abstain",
]);
export type VoteChoice = z.infer<typeof VoteChoice>;

export const ConsensusLabel = z.enum([
  "strong_consensus",
  "qualified_consensus",
  "disputed",
  "rejected",
]);
export type ConsensusLabel = z.infer<typeof ConsensusLabel>;

export const ModelId = z.string().min(1);
export const Confidence = z.number().min(0).max(1);

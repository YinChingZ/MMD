import { VoteSetSchema } from "@mmd/protocol";
import type { CompletionRequest } from "@mmd/model-adapters";
import { describeSchema } from "./schema-text.js";

export interface CandidateForVote {
  candidate_id: string;
  text: string;
}

export interface BuildVotePromptParams {
  question: string;
  modelId: string;
  candidates: CandidateForVote[];
}

export function buildVotePrompt(params: BuildVotePromptParams): CompletionRequest {
  const { question, modelId, candidates } = params;

  const systemPrompt = [
    "Vote on each candidate consensus claim.",
    "Distinguish 'approve' from 'approve_with_conditions' — use the latter when you'd only accept it with a stated caveat (fill required_condition).",
    "If you vote 'object', you must also set objection_severity (minor, major, or critical) and explain in `reason` why this blocks the main conclusion.",
    "Abstain only when you have no informed opinion, not as a way to avoid taking a position.",
    "Return ONLY JSON matching this schema, no prose outside the JSON:",
    describeSchema(VoteSetSchema, "VoteSet"),
  ].join("\n\n");

  const userPrompt = [
    `Question: ${question}`,
    "Candidates:",
    JSON.stringify(candidates, null, 2),
  ].join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    meta: { phase: "vote", modelId, candidates },
  };
}

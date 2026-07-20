import {
  PlanningFinalAnswerSchema,
  type GlobalComposeCandidate,
  type Topic,
} from "@mmd/protocol";
import type { CompletionRequest } from "@mmd/model-adapters";
import { describeSchema } from "./schema-text.js";

export function buildGlobalComposePrompt(params: {
  question: string;
  topics: Topic[];
  candidates: GlobalComposeCandidate[];
  priorContext?: string;
}): CompletionRequest {
  return {
    systemPrompt: [
      "Write one integrated planning answer from the classified topic candidates.",
      "You are an editor, not a judge. Strong and qualified candidates may support recommendations; disputed candidates must remain visibly disputed; rejected candidates must not be asserted.",
      "Every substantive output span must cite source_candidate_ids. Mark a genuinely new cross-topic inference as coordinator_synthesis and list derived_from_candidate_ids.",
      "If a strong_consensus candidate is omitted, include a specific reason in omitted_strong_candidate_reasons.",
      "Return ONLY JSON matching this schema:",
      describeSchema(PlanningFinalAnswerSchema, "PlanningFinalAnswer"),
    ].join("\n\n"),
    userPrompt: [
      ...(params.priorContext ? [params.priorContext] : []),
      `Question: ${params.question}`,
      `Topics: ${JSON.stringify(params.topics, null, 2)}`,
      `Classified candidates: ${JSON.stringify(params.candidates, null, 2)}`,
    ].join("\n\n"),
    meta: {
      phase: "global_compose",
      question: params.question,
      topics: params.topics,
      candidates: params.candidates,
    },
  };
}

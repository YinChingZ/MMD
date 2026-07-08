import type { CompletionRequest } from "@mmd/model-adapters";

export interface FormatUserOutputRequest {
  name?: string;
  schema: Record<string, unknown>;
  instructions?: string;
}

export interface BuildFormatUserOutputPromptParams {
  question: string;
  /** The already-finalized internal FinalAnswer or PlanDocument — never re-derived, only reshaped. */
  internalResult: unknown;
  outputFormat: FormatUserOutputRequest;
}

/**
 * M6.1: reformats the internal, already-consensus-checked result into a
 * caller-supplied JSON shape. This is a formatter, not a second judge — it
 * must not introduce facts or re-litigate disputed points, only reshape data
 * that already exists. Internal FinalAnswer/PlanDocument schemas stay the
 * source of truth; this is a one-way, additive projection of them.
 */
export function buildFormatUserOutputPrompt(
  params: BuildFormatUserOutputPromptParams
): CompletionRequest {
  const { question, internalResult, outputFormat } = params;

  const systemPrompt = [
    "You are a formatter, not a judge. You are given a final deliberation result that has already been produced through consensus among multiple models — your only job is to reshape it into the exact JSON format requested below.",
    "Do not introduce new facts, do not resolve or take a side on any disputed point, and do not omit any required field.",
    "If a requested field cannot be reliably derived from the result below, use null, an empty array, or whatever the schema otherwise allows — never invent content to fill a field.",
    "Return ONLY JSON matching this JSON Schema, no prose outside the JSON:",
    JSON.stringify(outputFormat.schema, null, 2),
    outputFormat.instructions
      ? `Additional formatting instructions from the caller: ${outputFormat.instructions}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const userPrompt = [
    `Question: ${question}`,
    `Final deliberation result to reformat:`,
    JSON.stringify(internalResult, null, 2),
  ].join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    meta: {
      step: "format_user_output",
      question,
      outputFormatName: outputFormat.name,
    },
  };
}

import type { DeliberationResult } from "./orchestrator.js";

export function toMarkdown(result: DeliberationResult): string {
  const lines: string[] = [];

  lines.push(`# Deliberation Result: ${result.runId}`);
  lines.push("");
  lines.push(`**Question:** ${result.question}`);
  lines.push(`**Mode:** ${result.mode}`);
  lines.push("");
  lines.push("## Final Answer");
  lines.push("");
  lines.push(result.final.final_answer);
  lines.push("");

  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push(`### ${title}`);
    lines.push("");
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  };

  section("Strong consensus", result.final.strong_consensus);
  section("Qualified consensus", result.final.qualified_consensus);
  section("Disputed", result.final.disputed_points);
  section("Rejected / unsupported", result.final.rejected_or_unsupported);

  if (result.final.model_position_changes.length) {
    lines.push("### Model position changes");
    lines.push("");
    for (const c of result.final.model_position_changes) {
      lines.push(`- **${c.model_id}**: "${c.changed_from}" -> "${c.changed_to}" (${c.reason})`);
    }
    lines.push("");
  }

  lines.push("## Run metadata");
  lines.push("");
  lines.push(
    `- Confidence: ${result.final.confidence_summary.consensus_strength} — ${result.final.confidence_summary.notes}`
  );
  lines.push(`- Timings (ms): ${JSON.stringify(result.timings)}`);

  const partialPhases = Object.entries(result.quorum)
    .filter(([, q]) => q?.partial)
    .map(([phase]) => phase);
  if (partialPhases.length) {
    lines.push(
      `- Partial phases (some models did not respond): ${partialPhases.join(", ")}`
    );
  }

  return lines.join("\n");
}

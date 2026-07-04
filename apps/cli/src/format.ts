import type { PositionChange } from "@mmd/protocol";
import type { DeliberationResult, TopicResult } from "./orchestrator.js";

interface ConsensusBucketsForRender {
  strong: string[];
  qualified: string[];
  disputed: string[];
  rejected: string[];
}

function renderConsensusSections(
  lines: string[],
  buckets: ConsensusBucketsForRender
): void {
  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push(`### ${title}`);
    lines.push("");
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  };
  section("Strong consensus", buckets.strong);
  section("Qualified consensus", buckets.qualified);
  section("Disputed", buckets.disputed);
  section("Rejected / unsupported", buckets.rejected);
}

function renderPositionChanges(
  lines: string[],
  changes: PositionChange[]
): void {
  if (!changes.length) return;
  lines.push("### Model position changes");
  lines.push("");
  for (const c of changes) {
    lines.push(
      `- **${c.model_id}**: "${c.changed_from}" -> "${c.changed_to}" (${c.reason})`
    );
  }
  lines.push("");
}

export function toMarkdown(result: DeliberationResult): string {
  if (result.planDocument) return toPlanMarkdown(result);

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

  renderConsensusSections(lines, {
    strong: result.final.strong_consensus,
    qualified: result.final.qualified_consensus,
    disputed: result.final.disputed_points,
    rejected: result.final.rejected_or_unsupported,
  });
  renderPositionChanges(lines, result.final.model_position_changes);

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

function toPlanMarkdown(result: DeliberationResult): string {
  const planDocument = result.planDocument;
  const topics = result.topics ?? [];
  if (!planDocument) {
    throw new Error("toPlanMarkdown called without a planDocument");
  }

  const lines: string[] = [];

  lines.push(`# Plan Document: ${result.runId}`);
  lines.push("");
  lines.push(`**Question:** ${result.question}`);
  lines.push(`**Mode:** ${result.mode}`);
  lines.push("");
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(planDocument.executive_summary);
  lines.push("");

  const topicById = new Map<string, TopicResult>(
    topics.map((t) => [t.topic.topic_id, t])
  );

  for (const section of planDocument.sections) {
    lines.push(`## ${section.title}`);
    lines.push("");
    lines.push(section.section_answer);
    lines.push("");

    renderConsensusSections(lines, {
      strong: section.strong_consensus,
      qualified: section.qualified_consensus,
      disputed: section.disputed_points,
      rejected: section.rejected_or_unsupported,
    });
    renderPositionChanges(lines, section.model_position_changes);

    const topicResult = topicById.get(section.topic_id);
    if (topicResult) {
      lines.push(
        `- Timings (ms): ${JSON.stringify(topicResult.timings)}`
      );
      const partialPhases = Object.entries(topicResult.quorum)
        .filter(([, q]) => q?.partial)
        .map(([phase]) => phase);
      if (partialPhases.length) {
        lines.push(
          `- Partial phases (some models did not respond): ${partialPhases.join(", ")}`
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

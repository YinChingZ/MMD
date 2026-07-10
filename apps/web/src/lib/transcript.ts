import type { Critique, Proposal, RevisionSet, VoteSet } from "@mmd/protocol";
import type { RunResult } from "./api";
import { messages } from "./messages";

function formatDeliberationBlock(
  proposals: Proposal[],
  critiques: Critique[],
  revisions: RevisionSet[],
  votes: VoteSet[],
): string[] {
  const lines: string[] = [];

  lines.push(`--- ${messages.run.phases.propose} ---`);
  for (const p of proposals) {
    lines.push(`[${p.model_id}] ${p.answer_summary}`);
    for (const c of p.claims) {
      lines.push(`  - ${c.text}（${c.type}, confidence ${c.confidence}）`);
    }
  }

  if (critiques.length) {
    lines.push("", `--- ${messages.run.phases.critique} ---`);
    for (const c of critiques) {
      lines.push(`[${c.reviewer_model_id}]`);
      for (const r of c.reviews) {
        lines.push(`  - ${r.stance}/${r.severity} · ${r.target_claim_id}：${r.comment}`);
      }
    }
  }

  if (revisions.length) {
    lines.push("", `--- ${messages.run.phases.revise} ---`);
    for (const r of revisions) {
      lines.push(`[${r.model_id}]`);
      for (const rev of r.revisions) {
        lines.push(
          `  - ${rev.decision} ${rev.original_claim_id}${rev.revised_text ? `："${rev.revised_text}"` : ""} —— ${rev.reason_for_change}`,
        );
      }
    }
  }

  if (votes.length) {
    lines.push("", `--- ${messages.run.phases.vote} ---`);
    for (const v of votes) {
      lines.push(`[${v.model_id}]`);
      for (const b of v.votes) {
        lines.push(
          `  - ${b.vote} · ${b.candidate_id}${b.objection_severity ? `（${b.objection_severity}）` : ""}：${b.reason}`,
        );
      }
    }
  }

  return lines;
}

/** 把一次完整协商（标准/快速/规划模式）格式化为纯文本，供"复制协商过程"使用。 */
export function buildTranscript(result: RunResult): string {
  const lines: string[] = [
    `问题：${result.question}`,
    `模式：${messages.modes[result.mode]?.name ?? result.mode}`,
    "",
  ];

  if (result.planDocument) {
    lines.push(`===== ${messages.results.executiveSummary} =====`);
    lines.push(result.planDocument.executive_summary, "");

    const topicById = new Map(
      (result.topics ?? []).map((t) => [t.topic.topic_id, t]),
    );
    for (const section of result.planDocument.sections) {
      lines.push(`===== ${section.title} =====`);
      const topic = topicById.get(section.topic_id);
      if (topic) {
        lines.push(
          ...formatDeliberationBlock(
            topic.proposals,
            topic.critiques,
            topic.revisions,
            topic.votes,
          ),
        );
        lines.push("");
      }
      lines.push(`--- ${section.title} ---`, section.section_answer, "");
    }
  } else {
    lines.push(
      ...formatDeliberationBlock(
        result.proposals,
        result.critiques,
        result.revisions,
        result.votes,
      ),
    );
    lines.push("", `===== ${messages.results.finalAnswer} =====`);
    lines.push(result.final.final_answer);
  }

  return lines.join("\n");
}

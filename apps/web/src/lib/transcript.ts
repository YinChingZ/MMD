import type {
  Critique,
  PlanDocument,
  PlanningFinalAnswer,
  Proposal,
  RevisionSet,
  VoteSet,
} from "@mmd/protocol";
import type { RunResult } from "./api";
import { messages } from "./messages";
import {
  classificationBasisFor,
  partialQuorumEntries,
} from "./result-trace";

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
    ...(result.mode === "standard"
      ? [`治理：${messages.governance[result.governance].name}`]
      : []),
    "",
  ];

  if (result.planningFinal) {
    lines.push(`===== ${messages.results.integratedPlanningAnswer} =====`);
    lines.push(result.planningFinal.final_answer, "");
    lines.push(`===== ${messages.results.outputLineage} =====`);
    for (const span of result.planningFinal.spans) {
      const candidateIds =
        span.lineage_kind === "coordinator_synthesis"
          ? span.derived_from_candidate_ids
          : span.source_candidate_ids;
      lines.push(
        `[${span.lineage_kind}] ${span.text}`,
        `  ${candidateIds.join(", ")}`,
      );
    }
    if (result.planningFinal.omitted_strong_candidate_reasons.length) {
      lines.push("", `--- ${messages.results.omittedStrongCandidates} ---`);
      for (const omission of result.planningFinal.omitted_strong_candidate_reasons) {
        lines.push(`- ${omission.candidate_id}: ${omission.reason}`);
      }
    }
    for (const topic of result.topics ?? []) {
      lines.push("", `===== ${topic.topic.title} =====`);
      lines.push(
        ...formatDeliberationBlock(
          topic.proposals,
          topic.critiques,
          topic.revisions,
          topic.votes,
        ),
      );
    }
  } else if (result.planDocument) {
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
    if (result.mode === "standard" && result.governance === "distributed") {
      const candidates = result.normalize.candidate_claims;
      const basis = classificationBasisFor(
        result.trace,
        candidates.map((candidate) => candidate.candidate_id),
      );
      lines.push("", `===== ${messages.results.authoritativeLedger} =====`);
      for (const candidate of candidates) {
        const classification = result.classifications[candidate.candidate_id];
        const candidateBasis = basis?.[candidate.candidate_id];
        lines.push(
          `[${classification?.label ?? "unknown"}] ${candidate.text}`,
          `  ${candidate.candidate_id} <- ${candidate.source_claim_ids.join(", ")}`,
        );
        if (candidateBasis) {
          lines.push(
            `  approve_ratio=${candidateBasis.approve_ratio}; ballots=${candidateBasis.ballots.length}/${candidateBasis.expected_voter_count}; partial=${candidateBasis.partial}`,
          );
        }
      }
      const partialQuorum = partialQuorumEntries(result.trace, ["align", "vote"]);
      if (partialQuorum.length > 0) {
        lines.push("", `--- ${messages.results.partialQuorum} ---`);
        for (const entry of partialQuorum) {
          lines.push(
            `${entry.phase}: ${entry.respondent_count}/${entry.expected_count}; required=${entry.required}`,
          );
        }
      }
    }
    lines.push("", `===== ${messages.results.finalAnswer} =====`);
    lines.push(result.final.final_answer);
  }

  return lines.join("\n");
}

/** Clean v3 Planning report: one authoritative integrated answer. */
export function buildPlanningReportText(
  planningFinal: PlanningFinalAnswer,
): string {
  return planningFinal.final_answer.trim();
}

/** Legacy PlanDocument report formatter for pre-v3 persisted runs. */
export function buildPlanReportText(planDocument: PlanDocument): string {
  const lines: string[] = [planDocument.executive_summary, ""];
  for (const section of planDocument.sections) {
    lines.push(`## ${section.title}`, "", section.section_answer, "");
  }
  return lines.join("\n").trim();
}

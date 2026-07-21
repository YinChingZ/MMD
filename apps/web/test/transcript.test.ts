import { describe, expect, it } from "vitest";
import { buildTranscript } from "../src/lib/transcript";
import type { RunResult } from "../src/lib/api";

const baseResult: RunResult = {
  runId: "run_1",
  question: "要不要迁移到 GraphQL？",
  mode: "standard",
  governance: "centralized",
  status: "completed",
  proposals: [
    {
      model_id: "model-a",
      answer_summary: "建议迁移",
      claims: [
        {
          claim_id: "c1",
          text: "GraphQL 减少过取数",
          type: "fact",
          confidence: 0.9,
          rationale: "字段级查询",
          conditions: [],
        },
      ],
      assumptions: [],
      risks: [],
    },
  ],
  critiques: [
    {
      reviewer_model_id: "model-b",
      reviews: [
        {
          target_claim_id: "c1",
          stance: "support",
          severity: "minor",
          comment: "同意，但要考虑缓存",
        },
      ],
    },
  ],
  revisions: [
    {
      model_id: "model-a",
      revisions: [
        {
          original_claim_id: "c1",
          decision: "keep",
          confidence: 0.9,
          reason_for_change: "无需修改",
          influenced_by: [],
        },
      ],
    },
  ],
  normalize: { candidate_claims: [] },
  votes: [
    {
      model_id: "model-b",
      votes: [
        {
          candidate_id: "cc1",
          vote: "approve",
          confidence: 0.8,
          reason: "证据充分",
        },
      ],
    },
  ],
  classifications: {},
  final: {
    final_answer: "建议迁移到 GraphQL。",
    strong_consensus: [],
    qualified_consensus: [],
    disputed_points: [],
    rejected_or_unsupported: [],
    model_position_changes: [],
    confidence_summary: { consensus_strength: "high", notes: "" },
  },
  timings: {},
  quorum: {},
};

describe("buildTranscript", () => {
  it("includes question, mode, and each phase's content", () => {
    const text = buildTranscript(baseResult);
    expect(text).toContain("要不要迁移到 GraphQL？");
    expect(text).toContain("GraphQL 减少过取数");
    expect(text).toContain("同意，但要考虑缓存");
    expect(text).toContain("建议迁移到 GraphQL。");
    expect(text).toContain("Centralized / Classic");
  });

  it("uses PlanningFinalAnswer as the authoritative v3 report", () => {
    const text = buildTranscript({
      ...baseResult,
      mode: "planning",
      governance: "centralized",
      planningFinal: {
        final_answer: "统一的跨主题答案。",
        spans: [
          {
            span_id: "span-1",
            text: "跨主题结论",
            source_candidate_ids: [],
            lineage_kind: "coordinator_synthesis",
            derived_from_candidate_ids: ["candidate-a", "candidate-b"],
          },
        ],
        omitted_strong_candidate_reasons: [],
      },
      topics: [],
    });
    expect(text).toContain("统一的跨主题答案。");
    expect(text).toContain("coordinator_synthesis");
    expect(text).toContain("candidate-a, candidate-b");
  });

  it("omits empty critique/revise/vote sections gracefully", () => {
    const text = buildTranscript({
      ...baseResult,
      critiques: [],
      revisions: [],
      votes: [],
    });
    expect(text).toContain("model-a");
    expect(text).not.toContain("model-b");
  });

  it("formats planning mode via executive summary and sections", () => {
    const planningResult: RunResult = {
      ...baseResult,
      mode: "planning",
      planDocument: {
        executive_summary: "总体建议迁移。",
        sections: [
          {
            topic_id: "t1",
            title: "架构",
            tldr: "迁移可行",
            section_answer: "架构上可行。",
            strong_consensus: [],
            qualified_consensus: [],
            disputed_points: [],
            rejected_or_unsupported: [],
            model_position_changes: [],
            confidence_summary: { consensus_strength: "high", notes: "" },
          },
        ],
      },
      topics: [],
    };
    const text = buildTranscript(planningResult);
    expect(text).toContain("总体建议迁移。");
    expect(text).toContain("架构上可行。");
  });
});

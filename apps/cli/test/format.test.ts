import { describe, expect, it } from "vitest";
import { toMarkdown } from "../src/format.js";
import type { DeliberationResult, TopicResult } from "@mmd/orchestrator";

function baseResult(): DeliberationResult {
  return {
    runId: "run_test",
    question: "Is X true?",
    mode: "standard",
    budget: {
      modelCount: 3,
      critiqueRounds: 1,
      targetP50Ms: 60_000,
      targetP95Ms: 120_000,
      phases: ["propose", "critique", "revise", "normalize", "vote", "compose"],
    },
    proposals: [],
    critiques: [],
    revisions: [],
    normalize: { candidate_claims: [] },
    votes: [],
    classifications: {},
    final: {
      final_answer: "X is true.",
      strong_consensus: ["X is true."],
      qualified_consensus: [],
      disputed_points: [],
      rejected_or_unsupported: [],
      model_position_changes: [
        {
          model_id: "model_a",
          changed_from: "old claim",
          changed_to: "new claim",
          reason: "persuaded by review",
        },
      ],
      confidence_summary: { consensus_strength: "high", notes: "n" },
    },
    timings: { propose: 10, compose: 5 },
    quorum: { propose: { met: true, required: 2, respondentCount: 3, partial: false } },
  };
}

describe("toMarkdown — standard/quick mode (unchanged flat rendering)", () => {
  it("renders question, final answer, consensus buckets, and position changes", () => {
    const md = toMarkdown(baseResult());
    expect(md).toContain("# Deliberation Result: run_test");
    expect(md).toContain("Is X true?");
    expect(md).toContain("X is true.");
    expect(md).toContain("### Strong consensus");
    expect(md).toContain("- X is true.");
    expect(md).toContain("### Model position changes");
    expect(md).toContain('"old claim" -> "new claim"');
    expect(md).toContain("Confidence: high");
  });

  it("omits empty consensus sections", () => {
    const md = toMarkdown(baseResult());
    expect(md).not.toContain("### Disputed");
    expect(md).not.toContain("### Rejected");
  });

  it("flags partial phases when quorum was not fully met", () => {
    const result = baseResult();
    result.quorum.propose = {
      met: true,
      required: 2,
      respondentCount: 2,
      partial: true,
    };
    const md = toMarkdown(result);
    expect(md).toMatch(/Partial phases.*propose/);
  });
});

describe("toMarkdown — v0.2 planning mode (sectioned document)", () => {
  function planResult(): DeliberationResult {
    const base = baseResult();
    const topicResult: TopicResult = {
      topic: { topic_id: "database", title: "Database", description: "Datastore choice" },
      proposals: [],
      critiques: [],
      revisions: [],
      normalize: { candidate_claims: [] },
      votes: [],
      classifications: {},
      timings: { propose: 20, compose: 8 },
      quorum: {
        propose: { met: true, required: 2, respondentCount: 2, partial: true },
      },
    };
    return {
      ...base,
      mode: "planning",
      outline: { topics: [topicResult.topic] },
      topics: [topicResult],
      planDocument: {
        executive_summary: "Database: use Postgres.",
        sections: [
          {
            topic_id: "database",
            title: "Database",
            tldr: "Database: use Postgres.",
            section_answer: "Use Postgres for the primary datastore.",
            strong_consensus: ["Use Postgres."],
            qualified_consensus: [],
            disputed_points: [],
            rejected_or_unsupported: [],
            model_position_changes: [],
            confidence_summary: { consensus_strength: "high", notes: "n" },
          },
        ],
      },
    };
  }

  it("renders an executive summary and one section per topic", () => {
    const md = toMarkdown(planResult());
    expect(md).toContain("# Plan Document: run_test");
    expect(md).toContain("## Executive Summary");
    expect(md).toContain("Database: use Postgres.");
    expect(md).toContain("## Database");
    expect(md).toContain("Use Postgres for the primary datastore.");
    expect(md).toContain("### Strong consensus");
    expect(md).toContain("- Use Postgres.");
  });

  it("surfaces per-topic timings and partial-quorum flags", () => {
    const md = toMarkdown(planResult());
    expect(md).toMatch(/Timings \(ms\).*"propose":20/);
    expect(md).toMatch(/Partial phases.*propose/);
  });

  it("does not fall back to the flat renderer when planDocument is present", () => {
    const md = toMarkdown(planResult());
    expect(md).not.toContain("# Deliberation Result:");
  });
});

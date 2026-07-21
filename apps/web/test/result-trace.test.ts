import { describe, expect, it } from "vitest";
import type { MmdTraceV3 } from "@mmd/protocol";
import {
  candidateSetTrace,
  classificationBasisFor,
  partialQuorumEntries,
  traceHasFailure,
} from "../src/lib/result-trace";

const trace = {
  candidate_sets: [
    {
      candidate_set_id: "set-root",
      governance: "distributed",
      candidate_ids: ["candidate-1"],
      classification_basis: {
        "candidate-1": {
          candidate_set_id: "set-root",
          expected_voter_count: 3,
          ballots: [],
          approve_ratio: 2 / 3,
          label: "qualified_consensus",
          partial: true,
        },
      },
      alignment: { decisions: [] },
    },
    {
      candidate_set_id: "set-topic",
      governance: "centralized",
      topic_id: "topic-1",
      candidate_ids: ["candidate-2"],
      classification_basis: {},
    },
  ],
  quorum: [
    {
      phase: "align",
      met: true,
      required: 2,
      respondent_count: 2,
      expected_count: 3,
      partial: true,
    },
  ],
  failures: [
    {
      phase: "compose",
      code: "coordinator_failed",
      message: "failed",
      recoverable: true,
    },
  ],
} as unknown as MmdTraceV3;

describe("result trace adapters", () => {
  it("selects root and topic candidate sets by lineage", () => {
    expect(candidateSetTrace(trace, ["candidate-1"])?.candidate_set_id).toBe(
      "set-root",
    );
    expect(
      candidateSetTrace(trace, ["candidate-2"], "topic-1")?.candidate_set_id,
    ).toBe("set-topic");
  });

  it("returns classification basis and partial quorum without fabricating data", () => {
    expect(
      classificationBasisFor(trace, ["candidate-1"])?.["candidate-1"]?.partial,
    ).toBe(true);
    expect(partialQuorumEntries(trace, ["align"])).toHaveLength(1);
    expect(classificationBasisFor(undefined, ["candidate-1"])).toBeUndefined();
  });

  it("detects presentation fallback failures", () => {
    expect(traceHasFailure(trace, "compose")).toBe(true);
    expect(traceHasFailure(trace, "global_compose")).toBe(false);
  });
});

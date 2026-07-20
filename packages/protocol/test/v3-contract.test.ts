import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ProtocolConfigurationError,
  assertModelSelection,
  candidatesFromClusters,
  checkQuorum,
  classifyCandidate,
  deterministicCompleteLink,
  resolveGovernance,
  stableCallId,
  stableCandidateId,
  stableCandidateSetId,
  TraceRecorderV3,
} from "../src/index.js";

interface Fixture {
  quorum: Array<{
    model_count: number;
    respondent_count: number;
    required: number;
    met: boolean;
    partial: boolean;
  }>;
  classification: Array<{
    ballots: Parameters<typeof classifyCandidate>[0]["ballotsForCandidate"];
    expected_voter_count: number;
    expected_label: string;
    expected_approve_ratio: number;
  }>;
  alignment: {
    claims: Array<{ claim_id: string; text: string; model_id: string }>;
    pair_support: Array<{
      left_claim_id: string;
      right_claim_id: string;
      support: number;
      cannot_link: boolean;
    }>;
    minimum_support: number;
    expected_clusters: string[][];
  };
  stable_ids: {
    run_id: string;
    topic_id: string;
    expected_candidate_set_id: string;
    expected_candidate_ids: string[];
    expected_call_id: string;
  };
}

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../contract/mmd-protocol-v3/fixtures/parity-golden.json", import.meta.url),
    "utf8"
  )
) as Fixture;

const scenarioMatrix = JSON.parse(
  readFileSync(
    new URL(
      "../../../contract/mmd-protocol-v3/fixtures/scenario-matrix.json",
      import.meta.url
    ),
    "utf8"
  )
) as {
  run_id: string;
  frozen_time: string;
  mock_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  cases: Array<{ case_id: string }>;
};

describe("mmd.v3 cross-language contract", () => {
  it("freezes the complete shared parity scenario matrix", () => {
    expect(scenarioMatrix.run_id).toBe("run_fixture");
    expect(scenarioMatrix.frozen_time).toBe("2026-01-01T00:00:00.000Z");
    expect(scenarioMatrix.mock_usage.total_tokens).toBe(
      scenarioMatrix.mock_usage.prompt_tokens +
        scenarioMatrix.mock_usage.completion_tokens
    );
    expect(scenarioMatrix.cases.map((item) => item.case_id)).toEqual([
      "quick_n2",
      "standard_c",
      "standard_d_equivalent",
      "standard_d_conflict_cannot_link",
      "standard_d_partial_quorum",
      "planning_normal",
      "planning_topic_brief_compression",
      "planning_global_compose_failure",
    ]);
  });

  it("matches quorum and classification golden vectors", () => {
    for (const vector of fixture.quorum) {
      expect(checkQuorum(vector.respondent_count, vector.model_count)).toEqual({
        met: vector.met,
        required: vector.required,
        respondentCount: vector.respondent_count,
        partial: vector.partial,
      });
    }
    for (const vector of fixture.classification) {
      const result = classifyCandidate({
        ballotsForCandidate: vector.ballots,
        expectedVoterCount: vector.expected_voter_count,
      });
      expect(result.label).toBe(vector.expected_label);
      expect(result.approveRatio).toBeCloseTo(vector.expected_approve_ratio);
    }
  });

  it("clusters with deterministic complete-link semantics", () => {
    const original = deterministicCompleteLink({
      claimIds: fixture.alignment.claims.map((claim) => claim.claim_id),
      pairSupport: fixture.alignment.pair_support,
      minimumSupport: fixture.alignment.minimum_support,
    });
    const reversed = deterministicCompleteLink({
      claimIds: fixture.alignment.claims.map((claim) => claim.claim_id).reverse(),
      pairSupport: [...fixture.alignment.pair_support].reverse(),
      minimumSupport: fixture.alignment.minimum_support,
    });
    expect(original.clusters).toEqual(fixture.alignment.expected_clusters);
    expect(reversed.clusters).toEqual(original.clusters);
    expect(original.clusters.flat().sort()).toEqual(
      fixture.alignment.claims.map((claim) => claim.claim_id).sort()
    );
    expect(
      original.clusters.some((cluster) =>
        cluster.includes("claim_a") && cluster.includes("claim_c")
      )
    ).toBe(false);
  });

  it("assigns stable host IDs", () => {
    const ids = fixture.stable_ids;
    expect(stableCandidateSetId(ids.run_id, "centralized", ids.topic_id)).toBe(
      ids.expected_candidate_set_id
    );
    expect([0, 1].map((index) => stableCandidateId(ids.run_id, index, ids.topic_id))).toEqual(
      ids.expected_candidate_ids
    );
    expect(stableCallId({
      runId: ids.run_id,
      topicId: ids.topic_id,
      phase: "vote",
      modelId: "model_a",
      index: 0,
    })).toBe(ids.expected_call_id);
  });

  it("builds distributed candidates from host clusters", () => {
    const candidates = candidatesFromClusters({
      runId: "run_fixture",
      topicId: "topic_000",
      claims: fixture.alignment.claims,
      clusters: fixture.alignment.expected_clusters,
    });
    expect(candidates.map((candidate) => candidate.candidate_id)).toEqual(
      fixture.stable_ids.expected_candidate_ids
    );
    expect(candidates[0].source_claim_ids).toEqual(["claim_a", "claim_b"]);
  });

  it("rejects unsupported governance and model selections", () => {
    expect(() => resolveGovernance("quick", "distributed")).toThrow(
      ProtocolConfigurationError
    );
    expect(() => resolveGovernance("standard", "distributed")).toThrow(
      /experiment manifest/
    );
    expect(resolveGovernance("standard", "distributed", {
      experiment_id: "exp_1",
      protocol_version: "mmd.v3",
      alignment_policy: { version: "align.v1", minimum_pair_support: 2 },
    })).toBe("distributed");
    expect(() => assertModelSelection({
      mode: "quick",
      modelIds: ["model_a", "model_b", "model_c"],
    })).toThrow(/exactly two/);
    expect(() => assertModelSelection({
      mode: "standard",
      modelIds: ["model_a", "model_b"],
      coordinatorModelId: "model_c",
    })).toThrow(/explicitly selected/);
  });

  it("keeps completed artifacts when a later phase fails", () => {
    const recorder = new TraceRecorderV3("run_fixture", "standard", "centralized");
    recorder.addArtifact({
      artifact_id: "artifact_propose",
      kind: "proposal_set",
      phase: "propose",
      status: "completed",
      parent_ids: [],
      payload: [],
    });
    recorder.addFailure({
      phase: "compose",
      code: "coordinator_failed",
      message: "compose failed after retry",
      recoverable: true,
    });
    const trace = recorder.finish();
    expect(trace.status).toBe("partial");
    expect(trace.artifacts).toHaveLength(1);
  });
});

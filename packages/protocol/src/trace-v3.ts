import type { RunMode } from "./budget.js";
import type {
  Governance,
  MmdTraceV3,
  TraceArtifact,
  TraceCall,
  TraceFailure,
} from "./schemas/v3.js";

export const V3_VERSIONS = {
  normalization: "normalize.v3",
  alignment: "complete-link.v1",
  decision_rule: "consensus.v1",
  renderer: "canonical.v1",
} as const;

export function stableCandidateSetId(
  runId: string,
  governance: Governance,
  topicId?: string
): string {
  return `${runId}::${topicId ?? "root"}::candidate_set::${governance}`;
}

export function stableCandidateId(runId: string, index: number, topicId?: string): string {
  return `${runId}::${topicId ?? "root"}::candidate::${String(index).padStart(3, "0")}`;
}

export function stableCallId(params: {
  runId: string;
  phase: string;
  modelId: string;
  index: number;
  topicId?: string;
}): string {
  return `${params.runId}::${params.topicId ?? "root"}::call::${params.phase}::${params.modelId}::${String(params.index).padStart(3, "0")}`;
}

export class TraceRecorderV3 {
  readonly trace: MmdTraceV3;

  constructor(runId: string, mode: RunMode, governance: Governance) {
    this.trace = {
      trace_version: "mmd.trace.v3",
      protocol_version: "mmd.v3",
      run_id: runId,
      mode,
      governance,
      status: "running",
      versions: { ...V3_VERSIONS },
      artifacts: [],
      candidate_sets: [],
      calls: [],
      quorum: [],
      failures: [],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        cost_usd: 0,
        usage_unavailable_count: 0,
      },
      extensions: {},
    };
  }

  addArtifact(artifact: TraceArtifact): void {
    if (this.trace.artifacts.some((item) => item.artifact_id === artifact.artifact_id)) {
      throw new Error(`duplicate artifact id: ${artifact.artifact_id}`);
    }
    this.trace.artifacts.push(artifact);
  }

  addCall(call: TraceCall): void {
    if (this.trace.calls.some((item) => item.call_id === call.call_id)) {
      throw new Error(`duplicate call id: ${call.call_id}`);
    }
    this.trace.calls.push(call);
    if (call.usage) {
      this.trace.usage.prompt_tokens += call.usage.prompt_tokens;
      this.trace.usage.completion_tokens += call.usage.completion_tokens;
      this.trace.usage.total_tokens += call.usage.total_tokens;
      this.trace.usage.cost_usd += call.usage.cost_usd;
      this.trace.usage.usage_unavailable_count += call.usage.usage_unavailable_count;
    }
  }

  addFailure(failure: TraceFailure): void {
    this.trace.failures.push(failure);
  }

  snapshot(): MmdTraceV3 {
    return structuredClone(this.trace);
  }

  finish(status?: "completed" | "partial" | "failed"): MmdTraceV3 {
    this.trace.status =
      status ?? (this.trace.failures.length > 0 ? "partial" : "completed");
    return this.trace;
  }
}

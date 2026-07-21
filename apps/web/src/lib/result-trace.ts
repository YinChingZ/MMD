import type {
  ClassificationBasis,
  MmdTraceV3,
} from "@mmd/protocol";

type CandidateSetTrace = MmdTraceV3["candidate_sets"][number];
type QuorumTrace = MmdTraceV3["quorum"][number];

export function candidateSetTrace(
  trace: MmdTraceV3 | undefined,
  candidateIds: string[],
  topicId?: string,
): CandidateSetTrace | undefined {
  if (!trace) return undefined;
  const expected = new Set(candidateIds);
  return trace.candidate_sets.find(
    (candidateSet) =>
      candidateSet.topic_id === topicId &&
      candidateSet.candidate_ids.some((id) => expected.has(id)),
  );
}

export function classificationBasisFor(
  trace: MmdTraceV3 | undefined,
  candidateIds: string[],
  topicId?: string,
): Record<string, ClassificationBasis> | undefined {
  return candidateSetTrace(trace, candidateIds, topicId)?.classification_basis;
}

export function partialQuorumEntries(
  trace: MmdTraceV3 | undefined,
  phases?: string[],
): QuorumTrace[] {
  if (!trace) return [];
  return trace.quorum.filter(
    (entry) =>
      entry.partial && (!phases || phases.includes(entry.phase)),
  );
}

export function traceHasFailure(
  trace: MmdTraceV3 | undefined,
  phase: string,
): boolean {
  return trace?.failures.some((failure) => failure.phase === phase) ?? false;
}

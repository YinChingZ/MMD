import {
  ProposalSchema,
  CritiqueSchema,
  RevisionSetSchema,
  NormalizeResultSchema,
  VoteSetSchema,
  FinalAnswerSchema,
  OutlineResultSchema,
  AlignResultSchema,
  PlanningFinalAnswerSchema,
  ClaimSchema,
  ReviewSchema,
  RevisionSchema,
  BallotSchema,
  CandidateClaimSchema,
  classifyCandidate,
  assertModelSelection,
  resolveGovernance,
  deterministicCompleteLink,
  candidatesFromClusters,
  stableCandidateSetId,
  stableCallId,
  TraceRecorderV3,
  makeRunId,
  getBudget,
  type Proposal,
  type Critique,
  type RevisionSet,
  type NormalizeResult,
  type CandidateClaim,
  type VoteSet,
  type Ballot,
  type FinalAnswer,
  type ClassifyCandidateResult,
  type QuorumCheck,
  type Phase,
  type RunMode,
  type RunBudget,
  type Topic,
  type OutlineResult,
  type SectionAnswer,
  type PlanDocument,
  type Governance,
  type ExperimentManifest,
  type MmdTraceV3,
  type TraceArtifact,
  type PlanningFinalAnswer,
  type GlobalComposeCandidate,
  type AlignResult,
} from "@mmd/protocol";
import {
  fanOutWithQuorum,
  callStructured,
  extractJson,
  ProviderStreamError,
  callJsonSchema,
  createValidatedArrayItemWatcher,
  createStringFieldWatcher,
  type ModelProvider,
  type ModelConfig,
  type CompletionRequest,
  type CompletionUsage,
  type FanoutOutcome,
  type FanoutResult,
  type FanoutAttemptContext,
} from "@mmd/model-adapters";
import {
  buildProposePrompt,
  buildCritiquePrompt,
  buildRevisePrompt,
  buildNormalizePrompt,
  buildVotePrompt,
  buildComposePrompt,
  buildOutlinePrompt,
  buildAlignPrompt,
  buildGlobalComposePrompt,
  buildFormatUserOutputPrompt,
  type ReviewWithReviewer,
  type PositionChangeInput,
  type FormatUserOutputRequest,
} from "@mmd/prompts";
import type { z } from "zod";

export type { FormatUserOutputRequest };

export type RunEventType =
  | "run_started"
  | "phase_started"
  | "model_attempt"
  | "model_responded"
  | "item_progress"
  | "token"
  | "phase_completed"
  | "run_failed"
  | "run_completed";

export interface RunEvent {
  type: RunEventType;
  runId: string;
  timestamp: string;
  phase?: Phase;
  data?: unknown;
}

export interface ModelFailure {
  modelId: string;
  message: string;
}

function describeFailures<T>(outcome: FanoutOutcome<T>): ModelFailure[] {
  return outcome.results
    .filter((r): r is Extract<typeof r, { ok: false }> => !r.ok)
    .map((r) => ({ modelId: r.config.id, message: r.error.message }));
}

/** Builds a `fanOutWithQuorum` `onSettled` callback that emits a
 * "model_responded" event the instant each model's call settles, so the
 * frontend can show per-model progress within a phase instead of waiting
 * for the whole phase to finish. */
function reportModelResponded(
  emit: (type: RunEventType, phase?: Phase, data?: Record<string, unknown>) => void,
  phase: Phase
) {
  return (result: FanoutResult<unknown>, _index: number, total: number) =>
    emit("model_responded", phase, {
      modelId: result.config.id,
      ok: result.ok,
      latencyMs: result.latencyMs,
      total,
      ...(result.ok ? {} : { error: result.error.message }),
    });
}

function withModelAttempt<T>(
  emit: (type: RunEventType, phase?: Phase, data?: Record<string, unknown>) => void,
  phase: Phase,
  modelId: string,
  context: FanoutAttemptContext | undefined,
  call: () => Promise<T>
): Promise<T> {
  if ((context?.attempt ?? 0) > 0) {
    emit("model_attempt", phase, {
      modelId,
      attempt: context!.attempt,
      transport: "non_stream",
      reason: "retryable_stream_failure",
    });
  }
  return call();
}

/**
 * Normalize/compose/outline/global_compose are single-coordinator calls with
 * no fanOutWithQuorum layer of their own — without this, a timeout/abort on
 * one of them propagates the raw fetch AbortError straight up with no phase
 * attribution and no run_failed SSE event (see docs — the "This operation was
 * aborted" bug report), unlike every quorum-wrapped phase above.
 */
function isAbortLikeError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || /aborted/i.test(err.message))
  );
}

function describeCoordinatorFailure(err: unknown, phaseLabel: string): string {
  if (isAbortLikeError(err)) {
    return `协调模型响应超时或被中断（阶段：${phaseLabel}）`;
  }
  return err instanceof Error ? err.message : String(err);
}

export class DeliberationQuorumError extends Error {
  constructor(
    public readonly phase: Phase,
    public readonly quorum: QuorumCheck,
    public readonly failures: ModelFailure[]
  ) {
    const detail = failures
      .map((f) => `${f.modelId}: ${f.message}`)
      .join(" | ");
    super(
      `phase "${phase}" did not meet quorum: ${quorum.respondentCount}/${quorum.required} required responses` +
        (detail ? ` — failures: ${detail}` : "")
    );
    this.name = "DeliberationQuorumError";
  }
}

export interface DeliberationInput {
  question: string;
  /** M6.7: the immediately-previous run's question+answer in this conversation, if any — threaded into propose/compose (and planning's outline). */
  priorContext?: string;
  /** M6.5: validated data URLs used only by independent propose calls. */
  images?: InputImage[];
  /** M6.6: unified, opt-in web-search switch for propose and critique. */
  webSearch?: boolean;
  models: ModelConfig[];
  provider: ModelProvider;
  mode?: RunMode;
  /** v3 product governance. Quick and Planning only accept centralized. */
  governance?: Governance;
  /** Required to unlock experimental distributed Standard. */
  experimentManifest?: ExperimentManifest;
  /** Model used for the single-authority normalize/compose calls. Defaults to models[0]. */
  coordinatorModelId?: string;
  fanoutOptions?: { timeoutMs?: number; retries?: number; backoffMs?: number };
  onEvent?: (event: RunEvent) => void;
  /** Incremental immutable trace snapshot, used by persistence on partial failure. */
  onTrace?: (trace: MmdTraceV3) => void;
  /**
   * Pre-generated run id (e.g. from @mmd/protocol's makeRunId()). Callers
   * that need the id before the run settles — the API's run-service responds
   * with {runId} immediately, before deliberation completes — should
   * generate it themselves and pass it in here rather than relying on
   * execution-order timing of the "run_started" event. Defaults to a fresh
   * makeRunId() call, unchanged from before this field existed.
   */
  runId?: string;
  /**
   * M5.1 cost circuit breaker: hard USD cap on the run's accumulated cost,
   * checked before each phase starts (not mid-phase — in-flight calls always
   * finish, matching the project's existing "graceful, bounded, not instant"
   * degradation style used for quorum). Undefined means no breaker at all,
   * which callers should treat as an explicit opt-out rather than a silent
   * default — see apps/api's route for where a default gets applied.
   */
  costLimitUsd?: number;
  /**
   * M6.1: optional caller-supplied JSON Schema. When set, one extra
   * coordinator call reformats the already-finalized internal
   * FinalAnswer/PlanDocument into this shape after the normal six-phase
   * deliberation completes — it never replaces or feeds back into the
   * internal result. Omitted entirely means today's behavior is unchanged.
   */
  outputFormat?: FormatUserOutputRequest;
  /** Internal resolved values threaded through mode-specific runners. */
  resolvedGovernance?: Governance;
  traceRecorder?: TraceRecorderV3;
}

/** A validated inline image persisted with a run, without exposing it in results. */
export interface InputImage {
  dataUrl: string;
}

/** Running total for the M5.1 cost circuit breaker, shared by reference across
 * whatever calls happen concurrently within one run (planning mode's parallel
 * topics all mutate the same instance). */
export interface CostState {
  totalUsd: number;
  /** true once at least one completion's cost couldn't be determined (unknown provider/model or missing usage) — surfaced so the UI can say "this run's cost total is a lower bound" rather than implying full coverage. */
  hasUnknownPricing: boolean;
}

export interface RunCostSummary {
  totalUsd: number;
  limitUsd?: number;
  hasUnknownPricing: boolean;
}

function newCostState(): CostState {
  return { totalUsd: 0, hasUnknownPricing: false };
}

function recordUsage(state: CostState, usage: CompletionUsage | undefined): void {
  if (!usage || usage.costUsd === undefined) {
    state.hasUnknownPricing = true;
    return;
  }
  state.totalUsd += usage.costUsd;
}

function costLimitExceeded(state: CostState, costLimitUsd: number | undefined): boolean {
  return costLimitUsd !== undefined && state.totalUsd > costLimitUsd;
}

export class CostLimitExceededError extends Error {
  constructor(
    phaseLabel: string,
    public readonly estimatedUsd: number,
    public readonly limitUsd: number
  ) {
    super(
      `cost limit exceeded before "${phaseLabel}": estimated $${estimatedUsd.toFixed(4)} so far > limit $${limitUsd.toFixed(2)}`
    );
    this.name = "CostLimitExceededError";
  }
}

export interface DeliberationResult {
  runId: string;
  question: string;
  mode: RunMode;
  governance: Governance;
  trace: MmdTraceV3;
  budget: RunBudget;
  proposals: Proposal[];
  critiques: Critique[];
  revisions: RevisionSet[];
  normalize: NormalizeResult;
  votes: VoteSet[];
  classifications: Record<string, ClassifyCandidateResult>;
  final: FinalAnswer;
  timings: Partial<Record<Phase, number>>;
  quorum: Partial<Record<Phase, QuorumCheck>>;
  cost: RunCostSummary;
  // v0.2 planning mode only. standard/quick mode leaves these undefined and
  // the flat fields above (proposals/normalize/votes/final/...) populated as
  // before; planning mode leaves the flat fields as harmless empty
  // placeholders (final.final_answer mirrors planDocument.executive_summary)
  // and puts the real per-topic data here instead.
  outline?: OutlineResult;
  topics?: TopicResult[];
  planDocument?: PlanDocument;
  /** v3 authoritative planning output. planDocument is a legacy projection. */
  planningFinal?: PlanningFinalAnswer;
  /**
   * M6.1: echoes the request's outputFormat (so saveResult can persist the
   * request/response pair together), the reformatted result once validated
   * against it, or an error string if repair retries were exhausted — the
   * latter never fails the run, matching per-model quorum's degrade-not-crash
   * style.
   */
  outputFormat?: FormatUserOutputRequest;
  userOutput?: unknown;
  userOutputError?: string;
}

/** v0.2 planning mode: one outline topic's full propose->critique->revise->normalize->vote->classify result. */
export interface TopicResult {
  topic: Topic;
  proposals: Proposal[];
  critiques: Critique[];
  revisions: RevisionSet[];
  normalize: NormalizeResult;
  votes: VoteSet[];
  classifications: Record<string, ClassifyCandidateResult>;
  candidateSetId?: string;
  timings: Partial<Record<Phase, number>>;
  quorum: Partial<Record<Phase, QuorumCheck>>;
  failures?: Partial<Record<Phase, ModelFailure[]>>;
}

function traceArtifact(
  input: DeliberationInput,
  artifact: TraceArtifact
): void {
  if (!input.traceRecorder) return;
  input.traceRecorder.addArtifact(artifact);
  input.onTrace?.(input.traceRecorder.snapshot());
}

function traceFanoutOutcome(params: {
  input: DeliberationInput;
  runId: string;
  phase: string;
  outcome: FanoutOutcome<unknown>;
  topicId?: string;
}): void {
  if (!params.input.traceRecorder) return;
  const recorder = params.input.traceRecorder;
  recorder.trace.quorum = recorder.trace.quorum.filter(
    (item) => item.phase !== params.phase || item.topic_id !== params.topicId
  );
  recorder.trace.quorum.push({
    phase: params.phase,
    topic_id: params.topicId,
    met: params.outcome.quorum.met,
    required: params.outcome.quorum.required,
    respondent_count: params.outcome.quorum.respondentCount,
    expected_count: params.outcome.results.length,
    partial: params.outcome.quorum.partial,
  });
  params.outcome.results.forEach((result, index) => {
    const timedOut =
      !result.ok &&
      (result.error.name.toLowerCase().includes("timeout") ||
        result.error.message.toLowerCase().includes("timed out"));
    params.input.traceRecorder!.addCall({
      call_id: stableCallId({
        runId: params.runId,
        phase: params.phase,
        modelId: result.config.id,
        index,
        topicId: params.topicId,
      }),
      phase: params.phase,
      model_id: result.config.id,
      role: "panel",
      status: result.ok ? "completed" : timedOut ? "timeout" : "failed",
      attempt: 0,
      topic_id: params.topicId,
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        cost_usd: 0,
        usage_unavailable_count: 1,
      },
      error_code: result.ok ? undefined : result.error.name || "provider_failed",
    });
    if (!result.ok) {
      recorder.addFailure({
        phase: params.phase,
        code: timedOut ? "provider_timeout" : "provider_failed",
        message: result.error.message,
        recoverable: params.outcome.quorum.met,
        topic_id: params.topicId,
        model_id: result.config.id,
      });
    }
  });
  params.input.onTrace?.(recorder.snapshot());
}

function traceCoordinatorAttempt(params: {
  input: DeliberationInput;
  runId: string;
  phase: string;
  modelId: string;
  attempt: number;
  status: "completed" | "failed" | "timeout";
  topicId?: string;
  error?: unknown;
  usage?: CompletionUsage;
}): void {
  if (!params.input.traceRecorder) return;
  params.input.traceRecorder.addCall({
    call_id: stableCallId({
      runId: params.runId,
      phase: params.phase,
      modelId: params.modelId,
      index: params.attempt,
      topicId: params.topicId,
    }),
    phase: params.phase,
    model_id: params.modelId,
    role: "coordinator",
    status: params.status,
    attempt: params.attempt,
    topic_id: params.topicId,
    usage: {
      prompt_tokens: params.usage?.promptTokens ?? 0,
      completion_tokens: params.usage?.completionTokens ?? 0,
      total_tokens:
        params.usage?.totalTokens ??
        (params.usage?.promptTokens ?? 0) + (params.usage?.completionTokens ?? 0),
      cost_usd: params.usage?.costUsd ?? 0,
      usage_unavailable_count: params.usage ? 0 : 1,
    },
    error_code:
      params.status === "completed"
        ? undefined
        : params.error instanceof Error
          ? params.error.name
          : "coordinator_failed",
  });
  params.input.onTrace?.(params.input.traceRecorder.snapshot());
}

function traceQuorumEntries(
  result: DeliberationResult,
  expectedCount: number
): MmdTraceV3["quorum"] {
  const root = Object.entries(result.quorum).flatMap(([phase, check]) =>
    check
      ? [{
          phase,
          met: check.met,
          required: check.required,
          respondent_count: check.respondentCount,
          expected_count: expectedCount,
          partial: check.partial,
        }]
      : []
  );
  const topics = (result.topics ?? []).flatMap((topic) =>
    Object.entries(topic.quorum).flatMap(([phase, check]) =>
      check
        ? [{
            phase,
            topic_id: topic.topic.topic_id,
            met: check.met,
            required: check.required,
            respondent_count: check.respondentCount,
            expected_count: expectedCount,
            partial: check.partial,
          }]
        : []
    )
  );
  return [...root, ...topics];
}

interface ResolvedClaim {
  claim_id: string;
  text: string;
  model_id: string;
}

function resolveFinalClaims(
  proposals: Proposal[],
  revisions: RevisionSet[]
): ResolvedClaim[] {
  const revisionByClaimId = new Map<
    string,
    RevisionSet["revisions"][number]
  >();
  for (const set of revisions) {
    for (const r of set.revisions) {
      revisionByClaimId.set(r.original_claim_id, r);
    }
  }

  const resolved: ResolvedClaim[] = [];
  for (const p of proposals) {
    for (const c of p.claims) {
      const rev = revisionByClaimId.get(c.claim_id);
      if (rev?.decision === "withdraw") continue;
      resolved.push({
        claim_id: c.claim_id,
        text: rev?.revised_text ?? c.text,
        model_id: p.model_id,
      });
    }
  }
  return resolved;
}

function reviewsForModel(
  modelId: string,
  proposals: Proposal[],
  critiques: Critique[]
): ReviewWithReviewer[] {
  const myClaimIds = new Set(
    proposals.find((p) => p.model_id === modelId)?.claims.map((c) => c.claim_id) ??
      []
  );
  const result: ReviewWithReviewer[] = [];
  for (const critique of critiques) {
    for (const review of critique.reviews) {
      if (myClaimIds.has(review.target_claim_id)) {
        result.push({ ...review, reviewer_model_id: critique.reviewer_model_id });
      }
    }
  }
  return result;
}

/**
 * Real models routinely ignore the model_id/claim_id fields entirely and
 * invent their own (sometimes another vendor's model name) — MockProvider
 * always faithfully echoed config.id, so this never showed up in tests.
 * We already know which config we called each result with, so we overwrite
 * self-reported identifiers with ground truth instead of trusting them, and
 * scope claim ids per model to guarantee uniqueness (two models both saying
 * "1" is not the same claim).
 */
function stampProposal(
  config: ModelConfig,
  proposal: Proposal,
  topicId?: string
): Proposal {
  return {
    ...proposal,
    model_id: config.id,
    claims: proposal.claims.map((c, i) => ({
      ...c,
      claim_id: topicId ? `${topicId}::${config.id}::c${i}` : `${config.id}::c${i}`,
      topic_id: topicId,
    })),
  };
}

function stampCritique(config: ModelConfig, critique: Critique): Critique {
  return { ...critique, reviewer_model_id: config.id };
}

function stampRevisionSet(config: ModelConfig, set: RevisionSet): RevisionSet {
  return { ...set, model_id: config.id };
}

function stampVoteSet(
  config: ModelConfig,
  set: VoteSet,
  candidateIds: Set<string>
): VoteSet {
  const seen = new Set<string>();
  return {
    ...set,
    model_id: config.id,
    votes: set.votes.filter((ballot) => {
      if (!candidateIds.has(ballot.candidate_id) || seen.has(ballot.candidate_id)) {
        return false;
      }
      seen.add(ballot.candidate_id);
      return true;
    }),
  };
}

function stampNormalizeResult(
  runId: string,
  normalize: NormalizeResult,
  claims: ResolvedClaim[],
  topicId?: string
): NormalizeResult {
  const expectedClaimIds = new Set(claims.map((claim) => claim.claim_id));
  const assignedClaimIds = new Set<string>();
  const sorted = [...normalize.candidate_claims].sort((left, right) => {
    const leftKey = [...left.source_claim_ids].sort().join("\u0000");
    const rightKey = [...right.source_claim_ids].sort().join("\u0000");
    return leftKey.localeCompare(rightKey) || left.text.localeCompare(right.text);
  });
  for (const candidate of sorted) {
    for (const claimId of candidate.source_claim_ids) {
      if (!expectedClaimIds.has(claimId)) {
        throw new Error(`normalize referenced unknown claim: ${claimId}`);
      }
      if (assignedClaimIds.has(claimId)) {
        throw new Error(`normalize assigned claim more than once: ${claimId}`);
      }
      assignedClaimIds.add(claimId);
    }
  }
  const missing = [...expectedClaimIds].filter((claimId) => !assignedClaimIds.has(claimId));
  if (missing.length > 0) {
    throw new Error(`normalize omitted claims: ${missing.join(", ")}`);
  }
  return {
    candidate_claims: sorted.map((candidate, index) => ({
      ...candidate,
      candidate_id: `${runId}::${topicId ?? "root"}::candidate::${String(index).padStart(3, "0")}`,
      source_claim_ids: [...new Set(candidate.source_claim_ids)].sort(),
      topic_id: topicId ?? candidate.topic_id,
    })),
  };
}

function fallbackNormalizeResult(
  runId: string,
  claims: ResolvedClaim[],
  topicId?: string
): NormalizeResult {
  const scope = topicId ?? "root";
  return {
    candidate_claims: [...claims]
      .sort((left, right) => left.claim_id.localeCompare(right.claim_id))
      .map((claim, index) => ({
        candidate_id: `${runId}::${scope}::candidate::${String(index).padStart(3, "0")}`,
        text: claim.text,
        source_claim_ids: [claim.claim_id],
        topic_id: topicId,
        notes: "deterministic fallback after coordinator normalization failure",
      })),
  };
}

function stampAlignResult(config: ModelConfig, result: AlignResult): AlignResult {
  return { ...result, aligner_model_id: config.id };
}

async function buildDistributedNormalize(params: {
  input: DeliberationInput;
  runId: string;
  question: string;
  claims: ResolvedClaim[];
  coordinatorTimeoutMs: number;
  topic?: Topic;
  onUsage: (usage: CompletionUsage | undefined) => void;
}): Promise<{ normalize: NormalizeResult; alignments: AlignResult[]; quorum: QuorumCheck; decisions: unknown[] }> {
  const outcome = await fanOutWithQuorum(
    params.input.models,
    (config, context) => structuredCall(
      params.input.provider,
      config,
      buildAlignPrompt({
        question: params.question,
        alignerModelId: config.id,
        claims: params.claims,
        topic: params.topic,
      }),
      AlignResultSchema,
      params.onUsage,
      { timeoutMs: params.coordinatorTimeoutMs, signal: context?.signal }
    ),
    {
      timeoutMs: params.coordinatorTimeoutMs,
      retries: params.input.fanoutOptions?.retries ?? 1,
      backoffMs: params.input.fanoutOptions?.backoffMs ?? 200,
    }
  );
  traceFanoutOutcome({
    input: params.input,
    runId: params.runId,
    phase: "align",
    outcome,
    topicId: params.topic?.topic_id,
  });
  if (!outcome.quorum.met) {
    throw new DeliberationQuorumError(
      "normalize",
      outcome.quorum,
      describeFailures(outcome)
    );
  }
  const alignments = outcome.succeeded.map((item) =>
    stampAlignResult(item.config, item.value)
  );
  const pairMap = new Map<string, { left_claim_id: string; right_claim_id: string; support: number; cannot_link: boolean }>();
  for (const alignment of alignments) {
    for (const judgment of alignment.judgments) {
      const [left, right] = [judgment.left_claim_id, judgment.right_claim_id].sort();
      if (left === right) continue;
      const key = `${left}\u0000${right}`;
      const current = pairMap.get(key) ?? {
        left_claim_id: left,
        right_claim_id: right,
        support: 0,
        cannot_link: false,
      };
      if (judgment.relation === "equivalent") current.support += 1;
      if (judgment.cannot_link || judgment.relation === "conflict") {
        current.cannot_link = true;
      }
      pairMap.set(key, current);
    }
  }
  const policy = params.input.experimentManifest!.alignment_policy!;
  const clustered = deterministicCompleteLink({
    claimIds: params.claims.map((claim) => claim.claim_id),
    pairSupport: [...pairMap.values()],
    minimumSupport: policy.minimum_pair_support,
  });
  return {
    normalize: {
      candidate_claims: candidatesFromClusters({
        runId: params.runId,
        topicId: params.topic?.topic_id,
        claims: params.claims,
        clusters: clustered.clusters,
      }),
    },
    alignments,
    quorum: outcome.quorum,
    decisions: clustered.decisions,
  };
}

function ballotsByCandidate(votes: VoteSet[]): Map<string, Ballot[]> {
  const map = new Map<string, Ballot[]>();
  for (const set of votes) {
    for (const ballot of set.votes) {
      const arr = map.get(ballot.candidate_id) ?? [];
      arr.push(ballot);
      map.set(ballot.candidate_id, arr);
    }
  }
  return map;
}

/** Quick mode has no explicit vote phase — treat each distinct source model in
 * source_claim_ids as one implicit "approve" ballot, so consensus strength is
 * still derived from how many models independently proposed the same idea. */
function impliedBallotsFromCoverage(
  candidate: CandidateClaim,
  claimsById: Map<string, ResolvedClaim>
): Ballot[] {
  const distinctModels = new Set(
    candidate.source_claim_ids
      .map((id) => claimsById.get(id)?.model_id)
      .filter((id): id is string => Boolean(id))
  );
  return Array.from(distinctModels).map((modelId) => ({
    candidate_id: candidate.candidate_id,
    vote: "approve" as const,
    confidence: 1,
    reason: `implied by independent proposal overlap from ${modelId} (quick mode, no explicit vote)`,
  }));
}

interface ConsensusBuckets {
  strongConsensus: string[];
  qualifiedConsensus: string[];
  disputed: string[];
  rejected: string[];
}

function computeConsensusBuckets(
  normalize: NormalizeResult,
  classifications: Record<string, ClassifyCandidateResult>
): ConsensusBuckets {
  const buckets: ConsensusBuckets = {
    strongConsensus: [],
    qualifiedConsensus: [],
    disputed: [],
    rejected: [],
  };
  for (const candidate of normalize.candidate_claims) {
    const label = classifications[candidate.candidate_id].label;
    if (label === "strong_consensus") buckets.strongConsensus.push(candidate.text);
    else if (label === "qualified_consensus")
      buckets.qualifiedConsensus.push(candidate.text);
    else if (label === "disputed") buckets.disputed.push(candidate.text);
    else buckets.rejected.push(candidate.text);
  }
  return buckets;
}

function deterministicCanonicalFinal(
  buckets: ConsensusBuckets,
  positionChanges: PositionChangeInput[],
  note: string
): FinalAnswer {
  const parts = [
    buckets.strongConsensus.length
      ? `Strong consensus:\n${buckets.strongConsensus.map((item) => `- ${item}`).join("\n")}`
      : undefined,
    buckets.qualifiedConsensus.length
      ? `Qualified consensus:\n${buckets.qualifiedConsensus.map((item) => `- ${item}`).join("\n")}`
      : undefined,
    buckets.disputed.length
      ? `Disputed:\n${buckets.disputed.map((item) => `- ${item}`).join("\n")}`
      : undefined,
  ].filter((part): part is string => Boolean(part));
  return {
    final_answer: parts.join("\n\n") || "No supported candidate reached consensus.",
    strong_consensus: buckets.strongConsensus,
    qualified_consensus: buckets.qualifiedConsensus,
    disputed_points: buckets.disputed,
    rejected_or_unsupported: buckets.rejected,
    model_position_changes: positionChanges,
    confidence_summary: {
      consensus_strength: buckets.disputed.length > 0 ? "low" : "medium",
      notes: note,
    },
  };
}

function computePositionChanges(
  proposals: Proposal[],
  revisions: RevisionSet[]
): PositionChangeInput[] {
  return revisions.flatMap((set) =>
    set.revisions
      .filter((r) => r.decision !== "keep")
      .map((r) => {
        const original = proposals
          .find((p) => p.model_id === set.model_id)
          ?.claims.find((c) => c.claim_id === r.original_claim_id);
        return {
          model_id: set.model_id,
          changed_from: original?.text ?? r.original_claim_id,
          changed_to:
            r.revised_text ??
            (r.decision === "withdraw"
              ? "(withdrawn)"
              : "(adopted another model's claim)"),
          reason: r.reason_for_change,
        };
      })
  );
}

/** Optional streaming hooks for `structuredCall` (M6.3/M6.4) — additive, so
 * every call site that doesn't pass this is unaffected. */
interface StreamHooks {
  /** Fresh delta handler per repair `attempt` — the call site's factory is
   * responsible for resetting its internal state when `attempt` changes,
   * since this arrow function itself is re-created from scratch on every
   * fanOutWithQuorum network retry (a new `stream` object is built at each
   * call site invocation), and callStructured's own repair-retry loop reuses
   * the same `stream` object across attempts within one call. */
  onDelta?: (delta: string, attempt: number) => void;
  /** Used for coordinator calls that do not already receive a fan-out AbortSignal. */
  timeoutMs?: number;
  signal?: AbortSignal;
  preferStream?: boolean;
  /** Coordinator phases get exactly one whole-call retry in protocol v3. */
  retryProviderFailureOnce?: boolean;
  traceContext?: {
    input: DeliberationInput;
    runId: string;
    phase: string;
    topicId?: string;
  };
}

async function structuredCall<T>(
  provider: ModelProvider,
  config: ModelConfig,
  request: CompletionRequest,
  schema: z.ZodType<T, z.ZodTypeDef, any>,
  onUsage?: (usage: CompletionUsage | undefined) => void,
  stream?: StreamHooks
): Promise<T> {
  const attemptUsage = new Map<number, CompletionUsage | undefined>();
  const run = (attemptOffset: number, maxRepairAttempts: number) =>
    callStructured(async (repairNote, attempt = 0) => {
      const effectiveAttempt = attemptOffset + attempt;
      const req: CompletionRequest = repairNote
        ? {
            ...request,
            userPrompt:
              typeof request.userPrompt === "string"
                ? `${request.userPrompt}\n\n${repairNote}`
                : [...request.userPrompt, { type: "text", text: repairNote }],
          }
        : request;
      const runProviderCall = <R>(call: (signal?: AbortSignal) => Promise<R>) =>
        stream?.signal
          ? call(stream.signal)
          : withProviderDeadline(stream?.timeoutMs, call);
      if (provider.completeStream && stream?.onDelta && stream.preferStream !== false) {
        try {
          const result = await runProviderCall((signal) =>
            provider.completeStream!(
              config,
              req,
              (delta) => stream.onDelta!(delta, effectiveAttempt),
              { signal }
            )
          );
          attemptUsage.set(effectiveAttempt, result.usage);
          onUsage?.(result.usage);
          return result;
        } catch (err) {
          if (err instanceof ProviderStreamError && canRecoverStructuredPartial(err, schema)) {
            return {
              text: err.partialText,
              latencyMs: 0,
              diagnostics: {
                transport: "stream" as const,
                providerRequestId: err.providerRequestId,
                finishReason: err.finishReason,
                errorType: err.errorType,
                recovered: true,
                degraded: true,
              },
            };
          }
          if (err instanceof ProviderStreamError && err.retryable && !stream.signal) {
            const result = await withProviderDeadline(stream.timeoutMs, (signal) =>
              provider.complete(config, req, { signal })
            );
            attemptUsage.set(effectiveAttempt, result.usage);
            onUsage?.(result.usage);
            return {
              ...result,
              diagnostics: {
                ...result.diagnostics,
                transport: "non_stream" as const,
                degraded: true,
                errorType: err.errorType,
              },
            };
          }
          throw err;
        }
      }
      const result = await runProviderCall((signal) =>
        provider.complete(config, req, { signal })
      );
      // Every attempt costs money, including repair retries — report each one,
      // not just the final accepted attempt.
      attemptUsage.set(effectiveAttempt, result.usage);
      onUsage?.(result.usage);
      return result;
    }, schema, { maxRepairAttempts });

  if (!stream?.retryProviderFailureOnce) {
    return run(0, 2);
  }
  try {
    const value = await run(0, 0);
    if (stream.traceContext) {
      traceCoordinatorAttempt({
        ...stream.traceContext,
        modelId: config.id,
        attempt: 0,
        status: "completed",
        usage: attemptUsage.get(0),
      });
    }
    return value;
  } catch (error) {
    if (stream.traceContext) {
      traceCoordinatorAttempt({
        ...stream.traceContext,
        modelId: config.id,
        attempt: 0,
        status: error instanceof Error && error.name === "AbortError" ? "timeout" : "failed",
        error,
        usage: attemptUsage.get(0),
      });
    }
  }
  try {
    const value = await run(1, 0);
    if (stream.traceContext) {
      traceCoordinatorAttempt({
        ...stream.traceContext,
        modelId: config.id,
        attempt: 1,
        status: "completed",
        usage: attemptUsage.get(1),
      });
    }
    return value;
  } catch (error) {
    if (stream.traceContext) {
      traceCoordinatorAttempt({
        ...stream.traceContext,
        modelId: config.id,
        attempt: 1,
        status: error instanceof Error && error.name === "AbortError" ? "timeout" : "failed",
        error,
        usage: attemptUsage.get(1),
      });
    }
    throw error;
  }
}

async function withProviderDeadline<T>(
  timeoutMs: number | undefined,
  call: (signal?: AbortSignal) => Promise<T>
): Promise<T> {
  if (!timeoutMs) return call(undefined);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`provider timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([call(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function canRecoverStructuredPartial<T>(
  err: ProviderStreamError,
  schema: z.ZodType<T, z.ZodTypeDef, any>
): boolean {
  if (["content_filter", "authentication", "invalid_request"].includes(err.errorType)) {
    return false;
  }
  try {
    return schema.safeParse(JSON.parse(extractJson(err.partialText))).success;
  } catch {
    return false;
  }
}

/** Per-phase item-array field + element schema, for M6.3's progressive
 * parsing — only these five phases fan out an array of a validated element
 * type; normalize/compose/outline/global_compose are excluded (normalize's
 * candidate_claims IS covered here since it's a fan-out-free single
 * coordinator call but still an array of a validated element type). */
const ARRAY_STREAM_CONFIG: Partial<
  Record<Phase, { field: string; schema: z.ZodType<any, any, any> }>
> = {
  propose: { field: "claims", schema: ClaimSchema },
  critique: { field: "reviews", schema: ReviewSchema },
  revise: { field: "revisions", schema: RevisionSchema },
  vote: { field: "votes", schema: BallotSchema },
  normalize: { field: "candidate_claims", schema: CandidateClaimSchema },
};

/** Builds a `StreamHooks.onDelta` that feeds a per-(phase,model) array-item
 * watcher, emitting a validated `item_progress` event for each item the
 * instant it's complete. A fresh watcher (index reset to 0) is created
 * whenever `attempt` changes — this is what makes "new attempt = clear and
 * redraw" work on the frontend with no extra backend bookkeeping: the same
 * `index === 0` signal also covers a `fanOutWithQuorum` network retry, since
 * the whole arrow function that builds this handler is re-invoked from
 * scratch on retry. */
function makeItemStreamHandler(
  emit: (type: RunEventType, phase?: Phase, data?: Record<string, unknown>) => void,
  phase: Phase,
  arrayField: string,
  itemSchema: z.ZodType<any, any, any>,
  modelId: string
): (delta: string, attempt: number) => void {
  let currentAttempt = -1;
  let watcher: { feed: (delta: string) => void } | null = null;
  let index = 0;
  return (delta, attempt) => {
    if (attempt !== currentAttempt) {
      currentAttempt = attempt;
      index = 0;
      watcher = createValidatedArrayItemWatcher(arrayField, itemSchema, (item) => {
        emit("item_progress", phase, { modelId, arrayField, index: index++, item, attempt });
      });
    }
    watcher!.feed(delta);
  };
}

function itemStreamHooks(
  emit: (type: RunEventType, phase?: Phase, data?: Record<string, unknown>) => void,
  phase: Phase,
  modelId: string,
  timeoutMs: number,
  context?: FanoutAttemptContext
): StreamHooks | undefined {
  const cfg = ARRAY_STREAM_CONFIG[phase];
  if (!cfg) return undefined;
  return {
    onDelta: makeItemStreamHandler(emit, phase, cfg.field, cfg.schema, modelId),
    timeoutMs,
    signal: context?.signal,
    preferStream: (context?.attempt ?? 0) === 0,
  };
}

/** M6.4: builds a `StreamHooks.onDelta` that relays a prose field's unescaped
 * characters via `token` events as they arrive. Unlike M6.3's item watcher,
 * compose/global_compose never go through fanOutWithQuorum (single
 * coordinator call / one call per topic, not fanned out), so there's no
 * network-retry race to reason about — only callStructured's own repair
 * `attempt` matters, handled the same way (fresh watcher per attempt). */
function makeTokenStreamHandler(
  emit: (type: RunEventType, phase?: Phase, data?: Record<string, unknown>) => void,
  phase: Phase,
  targetField: string,
  extraData?: Record<string, unknown>
): (delta: string, attempt: number) => void {
  let currentAttempt = -1;
  let watcher: { feed: (delta: string) => void } | null = null;
  return (delta, attempt) => {
    if (attempt !== currentAttempt) {
      currentAttempt = attempt;
      watcher = createStringFieldWatcher(targetField, (text) => {
        emit("token", phase, { delta: text, ...extraData });
      });
    }
    watcher!.feed(delta);
  };
}

/**
 * M6.1: reformats an already-finalized internal result (FinalAnswer or
 * PlanDocument) into a caller-supplied JSON shape. Never throws — a
 * repair-exhausted failure here degrades to `userOutputError` rather than
 * failing the whole run, matching the project's "one failure doesn't sink
 * the run" style used for per-model quorum. Cost-limit enforcement happens
 * at the call site (before this is invoked), same as every other phase.
 */
async function tryFormatUserOutput(params: {
  provider: ModelProvider;
  coordinator: ModelConfig;
  question: string;
  internalResult: unknown;
  outputFormat: FormatUserOutputRequest;
  costState: CostState;
  emitStep: (
    type: RunEventType,
    data?: Record<string, unknown>
  ) => void;
}): Promise<{ userOutput?: unknown; userOutputError?: string }> {
  const { provider, coordinator, question, internalResult, outputFormat, costState, emitStep } =
    params;
  emitStep("phase_started", { step: "format_user_output" });
  try {
    const userOutput = await callJsonSchema(async (repairNote) => {
      const request = buildFormatUserOutputPrompt({
        question,
        internalResult,
        outputFormat,
      });
      const req: CompletionRequest = repairNote
        ? { ...request, userPrompt: `${request.userPrompt}\n\n${repairNote}` }
        : request;
      const result = await provider.complete(coordinator, req);
      // Every attempt costs money, including repair retries.
      recordUsage(costState, result.usage);
      return result;
    }, outputFormat.schema);
    emitStep("phase_completed", { step: "format_user_output" });
    return { userOutput };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitStep("phase_completed", {
      step: "format_user_output",
      failed: true,
      error: message,
    });
    return { userOutputError: message };
  }
}

export async function runDeliberation(
  input: DeliberationInput
): Promise<DeliberationResult> {
  const mode = input.mode ?? "standard";
  const governance = resolveGovernance(
    mode,
    input.governance,
    input.experimentManifest
  );
  assertModelSelection({
    mode,
    modelIds: input.models.map((model) => model.id),
    coordinatorModelId: input.coordinatorModelId,
  });
  const runId = input.runId ?? makeRunId();
  const recorder = new TraceRecorderV3(runId, mode, governance);
  const resolvedInput: DeliberationInput = {
    ...input,
    runId,
    governance,
    resolvedGovernance: governance,
    traceRecorder: recorder,
  };
  input.onTrace?.(recorder.snapshot());

  try {
    const result = mode === "planning"
      ? await runPlanningDeliberation(resolvedInput)
      : await runStandardOrQuickDeliberation(resolvedInput);
    recorder.trace.usage.cost_usd = result.cost.totalUsd;
    const alignmentQuorum = recorder.trace.quorum.filter(
      (item) => item.phase === "align"
    );
    recorder.trace.quorum = [
      ...traceQuorumEntries(result, input.models.length),
      ...alignmentQuorum,
    ];
    const status = recorder.trace.failures.length > 0 ? "partial" : "completed";
    result.trace = recorder.finish(status);
    input.onTrace?.(recorder.snapshot());
    return result;
  } catch (error) {
    if (recorder.trace.failures.length === 0) {
      recorder.addFailure({
        phase: "run",
        code: "run_failed",
        message: error instanceof Error ? error.message : String(error),
        recoverable: false,
      });
    }
    recorder.finish("failed");
    input.onTrace?.(recorder.snapshot());
    throw error;
  }
}

async function runStandardOrQuickDeliberation(
  input: DeliberationInput
): Promise<DeliberationResult> {
  const runId = input.runId ?? makeRunId();
  const mode = input.mode ?? "standard";
  const governance = input.resolvedGovernance ?? "centralized";
  const budget = getBudget(mode);
  const fanout = {
    // Network deadlines are independent from the UI latency estimate. Quick
    // mode in particular used to reuse its unbenchmarked 40s p95 here, which
    // aborted healthy reasoning streams after they had already emitted items.
    timeoutMs: input.fanoutOptions?.timeoutMs ?? budget.providerTimeoutMs,
    retries: input.fanoutOptions?.retries ?? 1,
    backoffMs: input.fanoutOptions?.backoffMs ?? 200,
  };
  const coordinator = input.coordinatorModelId
    ? input.models.find((m) => m.id === input.coordinatorModelId)!
    : input.models[0];
  const toolFanout = {
    ...fanout,
    timeoutMs: fanout.timeoutMs + (input.webSearch ? budget.toolRoundTripAllowanceMs ?? 0 : 0),
  };

  const timings: Partial<Record<Phase, number>> = {};
  const quorum: Partial<Record<Phase, QuorumCheck>> = {};
  const costState = newCostState();

  const emit = (type: RunEventType, phase?: Phase, data?: unknown) =>
    input.onEvent?.({
      type,
      phase,
      runId,
      timestamp: new Date().toISOString(),
      data,
    });

  const assertWithinCostLimit = (phase: Phase) => {
    if (!costLimitExceeded(costState, input.costLimitUsd)) return;
    emit("run_failed", phase, {
      reason: "cost_limit_exceeded",
      estimatedUsd: costState.totalUsd,
      limitUsd: input.costLimitUsd,
    });
    throw new CostLimitExceededError(phase, costState.totalUsd, input.costLimitUsd!);
  };

  emit("run_started", undefined, { question: input.question, mode });

  // --- Propose (always runs) ---
  assertWithinCostLimit("propose");
  emit("phase_started", "propose");
  let t0 = Date.now();
  const proposeOutcome = await fanOutWithQuorum(
    input.models,
    (config, context) =>
      withModelAttempt(emit, "propose", config.id, context, () => structuredCall(
        input.provider,
        config,
        buildProposePrompt({
          question: input.question,
          modelId: config.id,
          images: input.images?.map((image) => image.dataUrl),
          webSearch: input.webSearch,
          priorContext: input.priorContext,
        }),
        ProposalSchema,
        (usage) => recordUsage(costState, usage),
        itemStreamHooks(emit, "propose", config.id, toolFanout.timeoutMs, context)
      )),
    { ...toolFanout, onSettled: reportModelResponded(emit, "propose") }
  );
  timings.propose = Date.now() - t0;
  quorum.propose = proposeOutcome.quorum;
  traceFanoutOutcome({ input, runId, phase: "propose", outcome: proposeOutcome });
  if (!proposeOutcome.quorum.met) {
    const failures = describeFailures(proposeOutcome);
    emit("run_failed", "propose", { quorum: proposeOutcome.quorum, failures });
    throw new DeliberationQuorumError("propose", proposeOutcome.quorum, failures);
  }
  const proposals = proposeOutcome.succeeded.map((s) =>
    stampProposal(s.config, s.value)
  );
  emit("phase_completed", "propose", {
    count: proposals.length,
    partial: proposeOutcome.quorum.partial,
    failures: describeFailures(proposeOutcome),
  });
  traceArtifact(input, {
    artifact_id: `${runId}::artifact::proposals`,
    kind: "proposal_set",
    phase: "propose",
    status: proposeOutcome.quorum.partial ? "partial" : "completed",
    parent_ids: [],
    payload: proposals,
  });

  // --- Critique (optional per budget) ---
  let critiques: Critique[] = [];
  if (budget.phases.includes("critique")) {
    assertWithinCostLimit("critique");
    emit("phase_started", "critique");
    t0 = Date.now();
    const critiqueOutcome = await fanOutWithQuorum(
      input.models,
      (config, context) =>
        withModelAttempt(emit, "critique", config.id, context, () => structuredCall(
          input.provider,
          config,
          buildCritiquePrompt({
            question: input.question,
            reviewerModelId: config.id,
            proposals,
            webSearch: input.webSearch,
          }),
          CritiqueSchema,
          (usage) => recordUsage(costState, usage),
          itemStreamHooks(emit, "critique", config.id, toolFanout.timeoutMs, context)
        )),
      { ...toolFanout, onSettled: reportModelResponded(emit, "critique") }
    );
    timings.critique = Date.now() - t0;
    quorum.critique = critiqueOutcome.quorum;
    traceFanoutOutcome({ input, runId, phase: "critique", outcome: critiqueOutcome });
    if (!critiqueOutcome.quorum.met) {
      const failures = describeFailures(critiqueOutcome);
      emit("run_failed", "critique", { quorum: critiqueOutcome.quorum, failures });
      throw new DeliberationQuorumError("critique", critiqueOutcome.quorum, failures);
    }
    critiques = critiqueOutcome.succeeded.map((s) =>
      stampCritique(s.config, s.value)
    );
    emit("phase_completed", "critique", {
      count: critiques.length,
      partial: critiqueOutcome.quorum.partial,
      failures: describeFailures(critiqueOutcome),
    });
    traceArtifact(input, {
      artifact_id: `${runId}::artifact::critiques`,
      kind: "critique_set",
      phase: "critique",
      status: critiqueOutcome.quorum.partial ? "partial" : "completed",
      parent_ids: [`${runId}::artifact::proposals`],
      payload: critiques,
    });
  }

  // --- Revise (optional per budget) ---
  let revisions: RevisionSet[] = [];
  if (budget.phases.includes("revise")) {
    assertWithinCostLimit("revise");
    emit("phase_started", "revise");
    t0 = Date.now();
    const reviseOutcome = await fanOutWithQuorum(
      input.models,
      (config, context) =>
        withModelAttempt(emit, "revise", config.id, context, () => structuredCall(
          input.provider,
          config,
          buildRevisePrompt({
            question: input.question,
            modelId: config.id,
            ownClaims:
              proposals.find((p) => p.model_id === config.id)?.claims ?? [],
            reviewsOnMine: reviewsForModel(config.id, proposals, critiques),
          }),
          RevisionSetSchema,
          (usage) => recordUsage(costState, usage),
          itemStreamHooks(emit, "revise", config.id, fanout.timeoutMs, context)
        )),
      { ...fanout, onSettled: reportModelResponded(emit, "revise") }
    );
    timings.revise = Date.now() - t0;
    quorum.revise = reviseOutcome.quorum;
    traceFanoutOutcome({ input, runId, phase: "revise", outcome: reviseOutcome });
    if (!reviseOutcome.quorum.met) {
      const failures = describeFailures(reviseOutcome);
      emit("run_failed", "revise", { quorum: reviseOutcome.quorum, failures });
      throw new DeliberationQuorumError("revise", reviseOutcome.quorum, failures);
    }
    revisions = reviseOutcome.succeeded.map((s) =>
      stampRevisionSet(s.config, s.value)
    );
    emit("phase_completed", "revise", {
      count: revisions.length,
      partial: reviseOutcome.quorum.partial,
      failures: describeFailures(reviseOutcome),
    });
    traceArtifact(input, {
      artifact_id: `${runId}::artifact::post_revision_claims`,
      kind: "post_revision_claim_set",
      phase: "revise",
      status: reviseOutcome.quorum.partial ? "partial" : "completed",
      parent_ids: [`${runId}::artifact::proposals`, `${runId}::artifact::critiques`],
      payload: resolveFinalClaims(proposals, revisions),
    });
  }

  const finalClaims = resolveFinalClaims(proposals, revisions);
  const claimsById = new Map(finalClaims.map((c) => [c.claim_id, c]));
  if (
    input.traceRecorder &&
    !input.traceRecorder.trace.artifacts.some(
      (artifact) => artifact.artifact_id === `${runId}::artifact::post_revision_claims`
    )
  ) {
    traceArtifact(input, {
      artifact_id: `${runId}::artifact::post_revision_claims`,
      kind: "post_revision_claim_set",
      phase: "propose",
      status: "completed",
      parent_ids: [`${runId}::artifact::proposals`],
      payload: finalClaims,
    });
  }

  // --- Normalize (single coordinator call) ---
  assertWithinCostLimit("normalize");
  emit("phase_started", "normalize");
  t0 = Date.now();
  let normalize: NormalizeResult;
  let alignmentPayload: unknown;
  try {
    if (governance === "distributed") {
      const distributed = await buildDistributedNormalize({
        input,
        runId,
        question: input.question,
        claims: finalClaims,
        coordinatorTimeoutMs: fanout.timeoutMs,
        onUsage: (usage) => recordUsage(costState, usage),
      });
      normalize = distributed.normalize;
      alignmentPayload = {
        policy: input.experimentManifest!.alignment_policy,
        alignments: distributed.alignments,
        decisions: distributed.decisions,
      };
      quorum.normalize = distributed.quorum;
    } else {
      normalize = await structuredCall(
        input.provider,
        coordinator,
        buildNormalizePrompt({
          question: input.question,
          claims: finalClaims,
        }),
        NormalizeResultSchema,
        (usage) => recordUsage(costState, usage),
        {
          ...itemStreamHooks(emit, "normalize", coordinator.id, fanout.timeoutMs),
          retryProviderFailureOnce: true,
          traceContext: { input, runId, phase: "normalize" },
        }
      );
      normalize = stampNormalizeResult(runId, normalize, finalClaims);
    }
  } catch (err) {
    const message = describeCoordinatorFailure(err, "归一");
    input.traceRecorder?.addFailure({
      phase: governance === "distributed" ? "align" : "normalize",
      code: governance === "distributed" ? "phase_quorum_not_met" : "coordinator_failed",
      message,
      recoverable: true,
    });
    if (governance === "distributed") {
      emit("run_failed", "normalize", { message });
      throw new Error(message);
    }
    normalize = fallbackNormalizeResult(runId, finalClaims);
    emit("phase_completed", "normalize", {
      count: normalize.candidate_claims.length,
      degraded: true,
      message,
    });
  }
  timings.normalize = Date.now() - t0;
  emit("phase_completed", "normalize", {
    count: normalize.candidate_claims.length,
  });
  const candidateSetId = stableCandidateSetId(runId, governance);
  traceArtifact(input, {
    artifact_id: `${runId}::artifact::candidate_set`,
    kind: "candidate_set",
    phase: governance === "distributed" ? "align" : "normalize",
    status: "completed",
    parent_ids: [`${runId}::artifact::post_revision_claims`],
    candidate_set_id: candidateSetId,
    payload: { candidates: normalize.candidate_claims, alignment: alignmentPayload },
  });

  // --- Vote (optional per budget) ---
  let votes: VoteSet[] = [];
  if (budget.phases.includes("vote")) {
    assertWithinCostLimit("vote");
    emit("phase_started", "vote");
    t0 = Date.now();
    const voteOutcome = await fanOutWithQuorum(
      input.models,
      (config, context) =>
        withModelAttempt(emit, "vote", config.id, context, () => structuredCall(
          input.provider,
          config,
          buildVotePrompt({
            question: input.question,
            modelId: config.id,
            candidates: normalize.candidate_claims.map((c) => ({
              candidate_id: c.candidate_id,
              text: c.text,
            })),
          }),
          VoteSetSchema,
          (usage) => recordUsage(costState, usage),
          itemStreamHooks(emit, "vote", config.id, fanout.timeoutMs, context)
        )),
      { ...fanout, onSettled: reportModelResponded(emit, "vote") }
    );
    timings.vote = Date.now() - t0;
    quorum.vote = voteOutcome.quorum;
    traceFanoutOutcome({ input, runId, phase: "vote", outcome: voteOutcome });
    if (!voteOutcome.quorum.met) {
      const failures = describeFailures(voteOutcome);
      emit("run_failed", "vote", { quorum: voteOutcome.quorum, failures });
      throw new DeliberationQuorumError("vote", voteOutcome.quorum, failures);
    }
    const candidateIds = new Set(
      normalize.candidate_claims.map((candidate) => candidate.candidate_id)
    );
    votes = voteOutcome.succeeded.map((s) =>
      stampVoteSet(s.config, s.value, candidateIds)
    );
    emit("phase_completed", "vote", {
      count: votes.length,
      partial: voteOutcome.quorum.partial,
      failures: describeFailures(voteOutcome),
    });
    traceArtifact(input, {
      artifact_id: `${runId}::artifact::ballots`,
      kind: "ballot_set",
      phase: "vote",
      status: voteOutcome.quorum.partial ? "partial" : "completed",
      parent_ids: [`${runId}::artifact::candidate_set`],
      candidate_set_id: candidateSetId,
      payload: votes,
    });
  }

  // --- Classify each candidate ---
  const ballotMap = budget.phases.includes("vote")
    ? ballotsByCandidate(votes)
    : undefined;

  const classifications: Record<string, ClassifyCandidateResult> = {};
  for (const candidate of normalize.candidate_claims) {
    const ballots = ballotMap
      ? ballotMap.get(candidate.candidate_id) ?? []
      : impliedBallotsFromCoverage(candidate, claimsById);
    classifications[candidate.candidate_id] = classifyCandidate({
      ballotsForCandidate: ballots,
      expectedVoterCount: input.models.length,
    });
  }

  const classificationBasis = Object.fromEntries(
    normalize.candidate_claims.map((candidate) => {
      const ballots = ballotMap
        ? ballotMap.get(candidate.candidate_id) ?? []
        : impliedBallotsFromCoverage(candidate, claimsById);
      const result = classifications[candidate.candidate_id];
      return [candidate.candidate_id, {
        candidate_set_id: candidateSetId,
        expected_voter_count: input.models.length,
        ballots,
        approve_ratio: result.approveRatio,
        label: result.label,
        partial: result.partial,
      }];
    })
  );
  input.traceRecorder?.trace.candidate_sets.push({
    candidate_set_id: candidateSetId,
    governance,
    candidate_ids: normalize.candidate_claims.map((candidate) => candidate.candidate_id),
    classification_basis: classificationBasis,
    alignment: alignmentPayload,
  });
  traceArtifact(input, {
    artifact_id: `${runId}::artifact::classifications`,
    kind: "classification_ledger",
    phase: "classify",
    status: "completed",
    parent_ids: [
      `${runId}::artifact::candidate_set`,
      ...(budget.phases.includes("vote") ? [`${runId}::artifact::ballots`] : []),
    ],
    candidate_set_id: candidateSetId,
    payload: classificationBasis,
  });

  const { strongConsensus, qualifiedConsensus, disputed, rejected } =
    computeConsensusBuckets(normalize, classifications);
  const positionChanges = computePositionChanges(proposals, revisions);

  // --- Compose (single coordinator call) ---
  assertWithinCostLimit("compose");
  emit("phase_started", "compose");
  t0 = Date.now();
  let final: FinalAnswer;
  try {
    final = await structuredCall(
      input.provider,
      coordinator,
      buildComposePrompt({
        question: input.question,
        priorContext: input.priorContext,
        strongConsensus,
        qualifiedConsensus,
        disputed,
        rejected,
        positionChanges,
      }),
      FinalAnswerSchema,
      (usage) => recordUsage(costState, usage),
      {
        onDelta: makeTokenStreamHandler(emit, "compose", "final_answer"),
        timeoutMs: fanout.timeoutMs,
        retryProviderFailureOnce: true,
        traceContext: { input, runId, phase: "compose" },
      }
    );
  } catch (err) {
    const message = describeCoordinatorFailure(err, "合成");
    input.traceRecorder?.addFailure({
      phase: "compose",
      code: "coordinator_failed",
      message,
      recoverable: true,
    });
    final = deterministicCanonicalFinal(
      { strongConsensus, qualifiedConsensus, disputed, rejected },
      positionChanges,
      "Coordinator compose failed after repair retry; deterministic classification ledger rendered instead."
    );
    emit("phase_completed", "compose", { degraded: true, message });
  }
  timings.compose = Date.now() - t0;
  emit("phase_completed", "compose");
  traceArtifact(input, {
    artifact_id: `${runId}::artifact::canonical_output`,
    kind: "canonical_output",
    phase: "compose",
    status: input.traceRecorder?.trace.failures.some((failure) => failure.phase === "compose")
      ? "partial"
      : "completed",
    parent_ids: [`${runId}::artifact::classifications`],
    candidate_set_id: candidateSetId,
    payload: final,
  });

  // --- Format to user-specified JSON (optional, M6.1) ---
  let userOutput: unknown;
  let userOutputError: string | undefined;
  if (input.outputFormat) {
    if (costLimitExceeded(costState, input.costLimitUsd)) {
      emit("run_failed", undefined, {
        step: "format_user_output",
        reason: "cost_limit_exceeded",
        estimatedUsd: costState.totalUsd,
        limitUsd: input.costLimitUsd,
      });
      throw new CostLimitExceededError(
        "format_user_output",
        costState.totalUsd,
        input.costLimitUsd!
      );
    }
    const formatted = await tryFormatUserOutput({
      provider: input.provider,
      coordinator,
      question: input.question,
      internalResult: final,
      outputFormat: input.outputFormat,
      costState,
      emitStep: (type, data) => emit(type, undefined, data),
    });
    userOutput = formatted.userOutput;
    userOutputError = formatted.userOutputError;
  }

  const cost: RunCostSummary = {
    totalUsd: costState.totalUsd,
    limitUsd: input.costLimitUsd,
    hasUnknownPricing: costState.hasUnknownPricing,
  };
  emit("run_completed", undefined, { runId, cost });

  return {
    runId,
    question: input.question,
    mode,
    governance,
    trace: input.traceRecorder?.snapshot() ?? new TraceRecorderV3(runId, mode, governance).snapshot(),
    budget,
    proposals,
    critiques,
    revisions,
    normalize,
    votes,
    classifications,
    final,
    timings,
    quorum,
    cost,
    outputFormat: input.outputFormat,
    userOutput,
    userOutputError,
  };
}

interface RunTopicDeliberationParams {
  runId: string;
  question: string;
  priorContext?: string;
  images?: InputImage[];
  webSearch?: boolean;
  toolRoundTripAllowanceMs?: number;
  models: ModelConfig[];
  provider: ModelProvider;
  topic: Topic;
  coordinator: ModelConfig;
  fanout: { timeoutMs: number; retries: number; backoffMs: number };
  onEvent?: (event: RunEvent) => void;
  /** Shared by reference across every topic running in parallel — see DeliberationInput.costLimitUsd. */
  costState: CostState;
  costLimitUsd?: number;
  traceInput?: DeliberationInput;
}

/** v0.2 planning mode: the same propose->critique->revise->normalize->vote->classify
 * sequence as runStandardOrQuickDeliberation, scoped to one outline topic. Always
 * runs the full phase set (no quick-mode-style skipping) since planning mode's
 * whole point is bounded-but-thorough per-topic deliberation. */
async function runTopicDeliberation(
  params: RunTopicDeliberationParams
): Promise<TopicResult> {
  const {
    runId,
    question,
    priorContext,
    images,
    webSearch,
    toolRoundTripAllowanceMs,
    models,
    provider,
    topic,
    coordinator,
    fanout,
    onEvent,
    costState,
    costLimitUsd,
  } = params;

  const timings: Partial<Record<Phase, number>> = {};
  const quorum: Partial<Record<Phase, QuorumCheck>> = {};
  const topicFailures: Partial<Record<Phase, ModelFailure[]>> = {};
  const toolFanout = {
    ...fanout,
    timeoutMs: fanout.timeoutMs + (webSearch ? toolRoundTripAllowanceMs ?? 0 : 0),
  };

  const emit = (
    type: RunEventType,
    phase?: Phase,
    data?: Record<string, unknown>
  ) =>
    onEvent?.({
      type,
      phase,
      runId,
      timestamp: new Date().toISOString(),
      data: { topicId: topic.topic_id, ...data },
    });

  const assertWithinCostLimit = (phase: Phase) => {
    if (!costLimitExceeded(costState, costLimitUsd)) return;
    emit("run_failed", phase, {
      reason: "cost_limit_exceeded",
      estimatedUsd: costState.totalUsd,
      limitUsd: costLimitUsd,
    });
    throw new CostLimitExceededError(
      `${topic.topic_id}:${phase}`,
      costState.totalUsd,
      costLimitUsd!
    );
  };

  assertWithinCostLimit("propose");
  emit("phase_started", "propose");
  let t0 = Date.now();
  const proposeOutcome = await fanOutWithQuorum(
    models,
    (config, context) =>
      withModelAttempt(emit, "propose", config.id, context, () => structuredCall(
        provider,
        config,
        buildProposePrompt({
          question,
          modelId: config.id,
          topic,
          images: images?.map((image) => image.dataUrl),
          webSearch,
          priorContext,
        }),
        ProposalSchema,
        (usage) => recordUsage(costState, usage),
        itemStreamHooks(emit, "propose", config.id, toolFanout.timeoutMs, context)
      )),
    { ...toolFanout, onSettled: reportModelResponded(emit, "propose") }
  );
  timings.propose = Date.now() - t0;
  quorum.propose = proposeOutcome.quorum;
  if (params.traceInput) {
    traceFanoutOutcome({
      input: params.traceInput,
      runId,
      phase: "propose",
      outcome: proposeOutcome,
      topicId: topic.topic_id,
    });
  }
  if (!proposeOutcome.quorum.met) {
    const failures = describeFailures(proposeOutcome);
    emit("run_failed", "propose", { quorum: proposeOutcome.quorum, failures });
    throw new DeliberationQuorumError("propose", proposeOutcome.quorum, failures);
  }
  const proposals = proposeOutcome.succeeded.map((s) =>
    stampProposal(s.config, s.value, topic.topic_id)
  );
  emit("phase_completed", "propose", {
    count: proposals.length,
    partial: proposeOutcome.quorum.partial,
    failures: describeFailures(proposeOutcome),
  });
  if (params.traceInput) {
    traceArtifact(params.traceInput, {
      artifact_id: `${runId}::${topic.topic_id}::artifact::proposals`,
      kind: "proposal_set",
      phase: "propose",
      status: proposeOutcome.quorum.partial ? "partial" : "completed",
      parent_ids: [],
      topic_id: topic.topic_id,
      payload: proposals,
    });
  }

  assertWithinCostLimit("critique");
  emit("phase_started", "critique");
  t0 = Date.now();
  const critiqueOutcome = await fanOutWithQuorum(
    models,
    (config, context) =>
      withModelAttempt(emit, "critique", config.id, context, () => structuredCall(
        provider,
        config,
        buildCritiquePrompt({
          question,
          reviewerModelId: config.id,
          proposals,
          topic,
          webSearch,
        }),
        CritiqueSchema,
        (usage) => recordUsage(costState, usage),
        itemStreamHooks(emit, "critique", config.id, toolFanout.timeoutMs, context)
      )),
    { ...toolFanout, onSettled: reportModelResponded(emit, "critique") }
  );
  timings.critique = Date.now() - t0;
  quorum.critique = critiqueOutcome.quorum;
  if (params.traceInput) {
    traceFanoutOutcome({
      input: params.traceInput,
      runId,
      phase: "critique",
      outcome: critiqueOutcome,
      topicId: topic.topic_id,
    });
  }
  if (!critiqueOutcome.quorum.met) {
    const failures = describeFailures(critiqueOutcome);
    emit("run_failed", "critique", { quorum: critiqueOutcome.quorum, failures });
    throw new DeliberationQuorumError("critique", critiqueOutcome.quorum, failures);
  }
  const critiques = critiqueOutcome.succeeded.map((s) =>
    stampCritique(s.config, s.value)
  );
  emit("phase_completed", "critique", {
    count: critiques.length,
    partial: critiqueOutcome.quorum.partial,
    failures: describeFailures(critiqueOutcome),
  });
  if (params.traceInput) {
    traceArtifact(params.traceInput, {
      artifact_id: `${runId}::${topic.topic_id}::artifact::critiques`,
      kind: "critique_set",
      phase: "critique",
      status: critiqueOutcome.quorum.partial ? "partial" : "completed",
      parent_ids: [`${runId}::${topic.topic_id}::artifact::proposals`],
      topic_id: topic.topic_id,
      payload: critiques,
    });
  }

  assertWithinCostLimit("revise");
  emit("phase_started", "revise");
  t0 = Date.now();
  const reviseOutcome = await fanOutWithQuorum(
    models,
    (config, context) =>
      withModelAttempt(emit, "revise", config.id, context, () => structuredCall(
        provider,
        config,
        buildRevisePrompt({
          question,
          modelId: config.id,
          ownClaims:
            proposals.find((p) => p.model_id === config.id)?.claims ?? [],
          reviewsOnMine: reviewsForModel(config.id, proposals, critiques),
        }),
        RevisionSetSchema,
        (usage) => recordUsage(costState, usage),
        itemStreamHooks(emit, "revise", config.id, fanout.timeoutMs, context)
      )),
    { ...fanout, onSettled: reportModelResponded(emit, "revise") }
  );
  timings.revise = Date.now() - t0;
  quorum.revise = reviseOutcome.quorum;
  if (params.traceInput) {
    traceFanoutOutcome({
      input: params.traceInput,
      runId,
      phase: "revise",
      outcome: reviseOutcome,
      topicId: topic.topic_id,
    });
  }
  if (!reviseOutcome.quorum.met) {
    const failures = describeFailures(reviseOutcome);
    emit("run_failed", "revise", { quorum: reviseOutcome.quorum, failures });
    throw new DeliberationQuorumError("revise", reviseOutcome.quorum, failures);
  }
  const revisions = reviseOutcome.succeeded.map((s) =>
    stampRevisionSet(s.config, s.value)
  );
  emit("phase_completed", "revise", {
    count: revisions.length,
    partial: reviseOutcome.quorum.partial,
    failures: describeFailures(reviseOutcome),
  });

  const finalClaims = resolveFinalClaims(proposals, revisions);
  if (params.traceInput) {
    traceArtifact(params.traceInput, {
      artifact_id: `${runId}::${topic.topic_id}::artifact::post_revision_claims`,
      kind: "post_revision_claim_set",
      phase: "revise",
      status: reviseOutcome.quorum.partial ? "partial" : "completed",
      parent_ids: [
        `${runId}::${topic.topic_id}::artifact::proposals`,
        `${runId}::${topic.topic_id}::artifact::critiques`,
      ],
      topic_id: topic.topic_id,
      payload: finalClaims,
    });
  }

  assertWithinCostLimit("normalize");
  emit("phase_started", "normalize");
  t0 = Date.now();
  let normalize: NormalizeResult;
  try {
    normalize = await structuredCall(
      provider,
      coordinator,
      buildNormalizePrompt({ question, claims: finalClaims, topic }),
      NormalizeResultSchema,
      (usage) => recordUsage(costState, usage),
      {
        ...itemStreamHooks(emit, "normalize", coordinator.id, fanout.timeoutMs),
        retryProviderFailureOnce: true,
        traceContext: params.traceInput
          ? {
              input: params.traceInput,
              runId,
              phase: "normalize",
              topicId: topic.topic_id,
            }
          : undefined,
      }
    );
    normalize = stampNormalizeResult(runId, normalize, finalClaims, topic.topic_id);
  } catch (err) {
    const message = describeCoordinatorFailure(err, `归一 · ${topic.title}`);
    topicFailures.normalize = [{ modelId: coordinator.id, message }];
    params.traceInput?.traceRecorder?.addFailure({
      phase: "normalize",
      code: "coordinator_failed",
      message,
      recoverable: true,
      topic_id: topic.topic_id,
      model_id: coordinator.id,
    });
    normalize = fallbackNormalizeResult(runId, finalClaims, topic.topic_id);
  }
  timings.normalize = Date.now() - t0;
  emit("phase_completed", "normalize", {
    count: normalize.candidate_claims.length,
  });
  const candidateSetId = stableCandidateSetId(runId, "centralized", topic.topic_id);
  if (params.traceInput) {
    traceArtifact(params.traceInput, {
      artifact_id: `${runId}::${topic.topic_id}::artifact::candidate_set`,
      kind: "candidate_set",
      phase: "normalize",
      status: topicFailures.normalize ? "partial" : "completed",
      parent_ids: [
        `${runId}::${topic.topic_id}::artifact::post_revision_claims`,
      ],
      topic_id: topic.topic_id,
      candidate_set_id: candidateSetId,
      payload: normalize.candidate_claims,
    });
  }

  assertWithinCostLimit("vote");
  emit("phase_started", "vote");
  t0 = Date.now();
  const voteOutcome = await fanOutWithQuorum(
    models,
    (config, context) =>
      withModelAttempt(emit, "vote", config.id, context, () => structuredCall(
        provider,
        config,
        buildVotePrompt({
          question,
          modelId: config.id,
          candidates: normalize.candidate_claims.map((c) => ({
            candidate_id: c.candidate_id,
            text: c.text,
          })),
        }),
        VoteSetSchema,
        (usage) => recordUsage(costState, usage),
        itemStreamHooks(emit, "vote", config.id, fanout.timeoutMs, context)
      )),
    { ...fanout, onSettled: reportModelResponded(emit, "vote") }
  );
  timings.vote = Date.now() - t0;
  quorum.vote = voteOutcome.quorum;
  if (params.traceInput) {
    traceFanoutOutcome({
      input: params.traceInput,
      runId,
      phase: "vote",
      outcome: voteOutcome,
      topicId: topic.topic_id,
    });
  }
  if (!voteOutcome.quorum.met) {
    const failures = describeFailures(voteOutcome);
    emit("run_failed", "vote", { quorum: voteOutcome.quorum, failures });
    throw new DeliberationQuorumError("vote", voteOutcome.quorum, failures);
  }
  const candidateIds = new Set(
    normalize.candidate_claims.map((candidate) => candidate.candidate_id)
  );
  const votes = voteOutcome.succeeded.map((s) =>
    stampVoteSet(s.config, s.value, candidateIds)
  );
  emit("phase_completed", "vote", {
    count: votes.length,
    partial: voteOutcome.quorum.partial,
    failures: describeFailures(voteOutcome),
  });
  if (params.traceInput) {
    traceArtifact(params.traceInput, {
      artifact_id: `${runId}::${topic.topic_id}::artifact::ballots`,
      kind: "ballot_set",
      phase: "vote",
      status: voteOutcome.quorum.partial ? "partial" : "completed",
      parent_ids: [`${runId}::${topic.topic_id}::artifact::candidate_set`],
      topic_id: topic.topic_id,
      candidate_set_id: candidateSetId,
      payload: votes,
    });
  }

  const ballotMap = ballotsByCandidate(votes);
  const classifications: Record<string, ClassifyCandidateResult> = {};
  for (const candidate of normalize.candidate_claims) {
    classifications[candidate.candidate_id] = classifyCandidate({
      ballotsForCandidate: ballotMap.get(candidate.candidate_id) ?? [],
      expectedVoterCount: models.length,
    });
  }

  if (params.traceInput?.traceRecorder) {
    const basis = Object.fromEntries(
      normalize.candidate_claims.map((candidate) => {
        const result = classifications[candidate.candidate_id];
        return [candidate.candidate_id, {
          candidate_set_id: candidateSetId,
          expected_voter_count: models.length,
          ballots: ballotMap.get(candidate.candidate_id) ?? [],
          approve_ratio: result.approveRatio,
          label: result.label,
          partial: result.partial,
        }];
      })
    );
    params.traceInput.traceRecorder.trace.candidate_sets.push({
      candidate_set_id: candidateSetId,
      governance: "centralized",
      topic_id: topic.topic_id,
      candidate_ids: normalize.candidate_claims.map((candidate) => candidate.candidate_id),
      classification_basis: basis,
    });
    traceArtifact(params.traceInput, {
      artifact_id: `${runId}::${topic.topic_id}::artifact::topic_ledger`,
      kind: "topic_ledger",
      phase: "classify",
      status:
        Object.values(quorum).some((item) => item.partial) ||
        Object.values(topicFailures).some((items) => (items?.length ?? 0) > 0)
          ? "partial"
          : "completed",
      parent_ids: [
        `${runId}::${topic.topic_id}::artifact::candidate_set`,
        `${runId}::${topic.topic_id}::artifact::ballots`,
      ],
      topic_id: topic.topic_id,
      candidate_set_id: candidateSetId,
      payload: { proposals, critiques, revisions, normalize, votes, classifications },
    });
  }

  return {
    topic,
    proposals,
    critiques,
    revisions,
    normalize,
    votes,
    classifications,
    candidateSetId,
    timings,
    quorum,
    failures: topicFailures,
  };
}

async function runPlanningDeliberation(
  input: DeliberationInput
): Promise<DeliberationResult> {
  const runId = input.runId ?? makeRunId();
  const governance = input.resolvedGovernance ?? "centralized";
  const budget = getBudget("planning");
  const fanout = {
    timeoutMs: input.fanoutOptions?.timeoutMs ?? budget.providerTimeoutMs,
    retries: input.fanoutOptions?.retries ?? 1,
    backoffMs: input.fanoutOptions?.backoffMs ?? 200,
  };
  const coordinator = input.coordinatorModelId
    ? input.models.find((m) => m.id === input.coordinatorModelId)!
    : input.models[0];
  const costState = newCostState();

  const emit = (type: RunEventType, phase?: Phase, data?: unknown) =>
    input.onEvent?.({
      type,
      phase,
      runId,
      timestamp: new Date().toISOString(),
      data,
    });

  const assertWithinCostLimit = (step: string) => {
    if (!costLimitExceeded(costState, input.costLimitUsd)) return;
    emit("run_failed", undefined, {
      step,
      reason: "cost_limit_exceeded",
      estimatedUsd: costState.totalUsd,
      limitUsd: input.costLimitUsd,
    });
    throw new CostLimitExceededError(step, costState.totalUsd, input.costLimitUsd!);
  };

  emit("run_started", undefined, { question: input.question, mode: "planning" });

  // --- Outline (single coordinator call — see docs/protocol.md for why this
  // doesn't need the multi-model treatment normalize does) ---
  assertWithinCostLimit("outline");
  emit("phase_started", undefined, { step: "outline" });
  const outlineStart = Date.now();
  let outline: OutlineResult;
  const crossCuttingTopic: Topic = {
    topic_id: "cross_cutting_risks_and_omissions",
    title: "Cross-cutting risks and omissions",
    description: "Risks, dependencies, interactions, and material omissions spanning multiple topics.",
  };
  try {
    outline = await structuredCall(
      input.provider,
      coordinator,
      buildOutlinePrompt({
        question: input.question,
        maxTopics: budget.maxTopics,
        priorContext: input.priorContext,
      }),
      OutlineResultSchema,
      (usage) => recordUsage(costState, usage),
      {
        retryProviderFailureOnce: true,
        traceContext: { input, runId, phase: "outline" },
      }
    );
    const withoutReserved = outline.topics.filter(
      (topic) => topic.topic_id !== crossCuttingTopic.topic_id
    );
    outline = {
      topics: [
        ...withoutReserved.slice(0, Math.max(0, (budget.maxTopics ?? 8) - 1)),
        crossCuttingTopic,
      ],
    };
    traceArtifact(input, {
      artifact_id: `${runId}::artifact::outline`,
      kind: "planning_outline",
      phase: "outline",
      status: "completed",
      parent_ids: [],
      payload: outline,
    });
  } catch (err) {
    const message = describeCoordinatorFailure(err, "拆题");
    input.traceRecorder?.addFailure({
      phase: "outline",
      code: "coordinator_failed",
      message,
      recoverable: true,
      model_id: coordinator.id,
    });
    outline = { topics: [crossCuttingTopic] };
    traceArtifact(input, {
      artifact_id: `${runId}::artifact::outline`,
      kind: "planning_outline",
      phase: "outline",
      status: "partial",
      parent_ids: [],
      payload: outline,
    });
    emit("phase_completed", undefined, {
      step: "outline",
      count: 1,
      degraded: true,
      message,
    });
  }
  emit("phase_completed", undefined, {
    step: "outline",
    count: outline.topics.length,
    timeMs: Date.now() - outlineStart,
    topics: outline.topics.map((topic) => ({
      topic_id: topic.topic_id,
      title: topic.title,
    })),
  });

  // --- Per-topic deliberation, in parallel (Promise.all one level up from
  // fanOutWithQuorum's per-model parallelism — sequential would multiply
  // latency by topic count, defeating the point). A single topic's failure
  // doesn't sink the whole plan, same graceful-degradation principle as
  // per-model quorum, applied one level up. ---
  const topicOutcomes = await Promise.allSettled(
    outline.topics.map((topic) =>
      runTopicDeliberation({
        runId,
        question: input.question,
        priorContext: input.priorContext,
        images: input.images,
        webSearch: input.webSearch,
        toolRoundTripAllowanceMs: budget.toolRoundTripAllowanceMs,
        models: input.models,
        provider: input.provider,
        topic,
        coordinator,
        fanout,
        onEvent: input.onEvent,
        costState,
        costLimitUsd: input.costLimitUsd,
        traceInput: input,
      })
    )
  );

  const topics: TopicResult[] = [];
  const failedTopics: { topic: Topic; error: string }[] = [];
  outline.topics.forEach((topic, i) => {
    const outcome = topicOutcomes[i];
    if (outcome.status === "fulfilled") {
      topics.push(outcome.value);
    } else {
      const message =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
      failedTopics.push({ topic, error: message });
      emit("phase_completed", undefined, {
        step: "topic",
        topicId: topic.topic_id,
        failed: true,
        error: message,
      });
    }
  });

  if (topics.length === 0) {
    const detail = failedTopics
      .map((f) => `${f.topic.topic_id}: ${f.error}`)
      .join(" | ");
    const message = `planning mode: all ${outline.topics.length} topic(s) failed — ${detail}`;
    // Previously this threw without ever emitting a terminal SSE event,
    // leaving any listening client's connection hanging indefinitely (known
    // gap noted in docs/protocol.md's M3 section) — the M5.1 cost breaker
    // makes "every topic fails for the same reason" a realistic path
    // (a shared cost limit breached partway through outline), not just a
    // multi-model-outage edge case, so this is now fixed alongside it.
    emit("run_failed", undefined, { failedTopics });
    throw new Error(message);
  }

  // --- One authoritative cross-topic GlobalCompose. ---
  assertWithinCostLimit("global_compose");
  const allCandidates: GlobalComposeCandidate[] = topics.flatMap((topicResult) =>
    topicResult.normalize.candidate_claims.map((candidate) => ({
      topic_id: topicResult.topic.topic_id,
      candidate_id: candidate.candidate_id,
      classification: topicResult.classifications[candidate.candidate_id].label,
      text: candidate.text,
    }))
  );
  let composeCandidates = allCandidates;
  let contextBudgetExceeded = false;
  if (JSON.stringify(composeCandidates).length > 60_000) {
    composeCandidates = allCandidates.map((candidate) => ({
      ...candidate,
      text: candidate.text.slice(0, 1_200),
    }));
    traceArtifact(input, {
      artifact_id: `${runId}::artifact::topic_briefs`,
      kind: "topic_brief_set",
      phase: "topic_brief",
      status: "completed",
      parent_ids: topics.map(
        (topic) => `${runId}::${topic.topic.topic_id}::artifact::topic_ledger`
      ),
      payload: composeCandidates,
    });
    contextBudgetExceeded = JSON.stringify(composeCandidates).length > 60_000;
  }

  const allowedCandidateIds = new Set(allCandidates.map((candidate) => candidate.candidate_id));
  const strongCandidateIds = new Set(
    allCandidates
      .filter((candidate) => candidate.classification === "strong_consensus")
      .map((candidate) => candidate.candidate_id)
  );
  let planningFinal: PlanningFinalAnswer;
  let globalComposeDegraded = false;
  emit("phase_started", "compose", { step: "global_compose" });
  try {
    if (contextBudgetExceeded) {
      throw new Error(
        "GlobalCompose input remains over budget after one topic-brief compression"
      );
    }
    planningFinal = await structuredCall(
      input.provider,
      coordinator,
      buildGlobalComposePrompt({
        question: input.question,
        topics: topics.map((topic) => topic.topic),
        candidates: composeCandidates,
        priorContext: input.priorContext,
      }),
      PlanningFinalAnswerSchema,
      (usage) => recordUsage(costState, usage),
      {
        onDelta: makeTokenStreamHandler(emit, "compose", "final_answer"),
        timeoutMs: fanout.timeoutMs,
        retryProviderFailureOnce: true,
        traceContext: { input, runId, phase: "global_compose" },
      }
    );
    planningFinal = {
      ...planningFinal,
      spans: planningFinal.spans.map((span, index) => ({
        ...span,
        span_id: `${runId}::output_span::${String(index).padStart(3, "0")}`,
      })),
    };
    const cited = new Set<string>();
    for (const span of planningFinal.spans) {
      const lineage = [
        ...span.source_candidate_ids,
        ...span.derived_from_candidate_ids,
      ];
      if (lineage.length === 0 || lineage.some((id) => !allowedCandidateIds.has(id))) {
        throw new Error("GlobalCompose returned an invalid or empty candidate lineage");
      }
      lineage.forEach((id) => cited.add(id));
    }
    const omitted = new Set(
      planningFinal.omitted_strong_candidate_reasons.map((item) => item.candidate_id)
    );
    for (const candidateId of strongCandidateIds) {
      if (!cited.has(candidateId) && !omitted.has(candidateId)) {
        throw new Error(`GlobalCompose omitted strong candidate without a reason: ${candidateId}`);
      }
    }
  } catch (err) {
    globalComposeDegraded = true;
    const message = describeCoordinatorFailure(err, "GlobalCompose");
    input.traceRecorder?.addFailure({
      phase: "global_compose",
      code: contextBudgetExceeded
        ? "context_budget_exceeded"
        : "global_compose_failed",
      message,
      recoverable: true,
    });
    const included = allCandidates.filter(
      (candidate) => candidate.classification !== "rejected"
    );
    const fallbackCandidates = included.length > 0 ? included : allCandidates.slice(0, 1);
    planningFinal = {
      final_answer: topics
        .map((topicResult) => {
          const topicCandidates = included.filter(
            (candidate) => candidate.topic_id === topicResult.topic.topic_id
          );
          return `## ${topicResult.topic.title}\n\n${
            topicCandidates.length > 0
              ? topicCandidates
                  .map((candidate) =>
                    candidate.classification === "disputed"
                      ? `- Disputed: ${candidate.text}`
                      : `- ${candidate.text}`
                  )
                  .join("\n")
              : "- No supported candidate reached consensus."
          }`;
        })
        .join("\n\n"),
      spans: fallbackCandidates.map((candidate, index) => ({
        span_id: `${runId}::output_span::${String(index).padStart(3, "0")}`,
        text: candidate.text,
        source_candidate_ids: [candidate.candidate_id],
        lineage_kind: "candidate",
        derived_from_candidate_ids: [],
      })),
      omitted_strong_candidate_reasons: allCandidates
        .filter(
          (candidate) =>
            candidate.classification === "strong_consensus" &&
            !fallbackCandidates.some((item) => item.candidate_id === candidate.candidate_id)
        )
        .map((candidate) => ({
          candidate_id: candidate.candidate_id,
          reason: "Omitted only because GlobalCompose failed; preserved in the topic ledger.",
        })),
    };
  }
  emit("phase_completed", "compose", {
    step: "global_compose",
    degraded: globalComposeDegraded,
  });
  traceArtifact(input, {
    artifact_id: `${runId}::artifact::planning_final`,
    kind: "planning_final_answer",
    phase: "global_compose",
    status: globalComposeDegraded ? "partial" : "completed",
    parent_ids: topics.map(
      (topic) => `${runId}::${topic.topic.topic_id}::artifact::topic_ledger`
    ),
    payload: planningFinal,
  });

  const executiveSummary = planningFinal.final_answer;
  // Compatibility-only projection for existing UI/readers. It is derived
  // from the authoritative GlobalCompose output and never fed back into v3.
  const sections: SectionAnswer[] = topics.map((topicResult) => {
    const buckets = computeConsensusBuckets(
      topicResult.normalize,
      topicResult.classifications
    );
    return {
      topic_id: topicResult.topic.topic_id,
      title: topicResult.topic.title,
      tldr: buckets.strongConsensus[0] ?? buckets.qualifiedConsensus[0] ?? "No consensus reached.",
      section_answer: planningFinal.spans
        .filter((span) =>
          span.source_candidate_ids.some((candidateId) =>
            topicResult.normalize.candidate_claims.some(
              (candidate) => candidate.candidate_id === candidateId
            )
          )
        )
        .map((span) => span.text)
        .join("\n\n") || "No integrated output span was assigned to this topic.",
      strong_consensus: buckets.strongConsensus,
      qualified_consensus: buckets.qualifiedConsensus,
      disputed_points: buckets.disputed,
      rejected_or_unsupported: buckets.rejected,
      model_position_changes: computePositionChanges(
        topicResult.proposals,
        topicResult.revisions
      ),
      confidence_summary: {
        consensus_strength: buckets.disputed.length > 0 ? "low" : "medium",
        notes: "Compatibility projection from mmd.v3 topic ledger and GlobalCompose lineage.",
      },
    };
  });
  const planDocument: PlanDocument = {
    executive_summary: executiveSummary,
    sections,
  };

  // --- Format to user-specified JSON (optional, M6.1) ---
  let userOutput: unknown;
  let userOutputError: string | undefined;
  if (input.outputFormat) {
    assertWithinCostLimit("format_user_output");
    const formatted = await tryFormatUserOutput({
      provider: input.provider,
      coordinator,
      question: input.question,
      internalResult: planDocument,
      outputFormat: input.outputFormat,
      costState,
      emitStep: (type, data) => emit(type, undefined, data),
    });
    userOutput = formatted.userOutput;
    userOutputError = formatted.userOutputError;
  }

  const cost: RunCostSummary = {
    totalUsd: costState.totalUsd,
    limitUsd: input.costLimitUsd,
    hasUnknownPricing: costState.hasUnknownPricing,
  };

  emit("run_completed", undefined, {
    runId,
    topicCount: topics.length,
    failedTopics,
    cost,
  });

  return {
    runId,
    question: input.question,
    mode: "planning",
    governance,
    trace: input.traceRecorder?.snapshot() ?? new TraceRecorderV3(runId, "planning", governance).snapshot(),
    budget,
    proposals: [],
    critiques: [],
    revisions: [],
    normalize: { candidate_claims: [] },
    votes: [],
    classifications: {},
    final: {
      final_answer: executiveSummary,
      strong_consensus: [],
      qualified_consensus: [],
      disputed_points: [],
      rejected_or_unsupported: [],
      model_position_changes: [],
      confidence_summary: {
        consensus_strength: "medium",
        notes: "See planDocument for per-section detail.",
      },
    },
    timings: {},
    quorum: {},
    cost,
    outline,
    topics,
    planDocument,
    planningFinal,
    outputFormat: input.outputFormat,
    userOutput,
    userOutputError,
  };
}

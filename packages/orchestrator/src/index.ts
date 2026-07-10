import {
  ProposalSchema,
  CritiqueSchema,
  RevisionSetSchema,
  NormalizeResultSchema,
  VoteSetSchema,
  FinalAnswerSchema,
  OutlineResultSchema,
  SectionAnswerSchema,
  ClaimSchema,
  ReviewSchema,
  RevisionSchema,
  BallotSchema,
  CandidateClaimSchema,
  classifyCandidate,
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
  buildSectionComposePrompt,
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
 * Normalize/compose/outline/section_compose are single-coordinator calls with
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
  /** Model used for the single-authority normalize/compose calls. Defaults to models[0]. */
  coordinatorModelId?: string;
  fanoutOptions?: { timeoutMs?: number; retries?: number; backoffMs?: number };
  onEvent?: (event: RunEvent) => void;
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
  timings: Partial<Record<Phase, number>>;
  quorum: Partial<Record<Phase, QuorumCheck>>;
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

function stampVoteSet(config: ModelConfig, set: VoteSet): VoteSet {
  return { ...set, model_id: config.id };
}

/** Same self-reported-identity problem as stampProposal etc: real models
 * routinely invent their own (more descriptive) topic_id instead of echoing
 * back the one we gave them in the prompt, which breaks the topicById
 * lookup format.ts relies on to attach per-topic timings/quorum. Ground
 * truth wins. */
function stampSectionAnswer(topic: Topic, section: SectionAnswer): SectionAnswer {
  return { ...section, topic_id: topic.topic_id, title: topic.title };
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
}

async function structuredCall<T>(
  provider: ModelProvider,
  config: ModelConfig,
  request: CompletionRequest,
  schema: z.ZodType<T, z.ZodTypeDef, any>,
  onUsage?: (usage: CompletionUsage | undefined) => void,
  stream?: StreamHooks
): Promise<T> {
  return callStructured(async (repairNote, attempt = 0) => {
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
            (delta) => stream.onDelta!(delta, attempt),
            { signal }
          )
        );
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
    onUsage?.(result.usage);
    return result;
  }, schema);
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
 * type; normalize/compose/outline/section_compose are excluded (normalize's
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
 * compose/section_compose never go through fanOutWithQuorum (single
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
  if ((input.mode ?? "standard") === "planning") {
    return runPlanningDeliberation(input);
  }
  return runStandardOrQuickDeliberation(input);
}

async function runStandardOrQuickDeliberation(
  input: DeliberationInput
): Promise<DeliberationResult> {
  const runId = input.runId ?? makeRunId();
  const mode = input.mode ?? "standard";
  const budget = getBudget(mode);
  const fanout = {
    // Network deadlines are independent from the UI latency estimate. Quick
    // mode in particular used to reuse its unbenchmarked 40s p95 here, which
    // aborted healthy reasoning streams after they had already emitted items.
    timeoutMs: input.fanoutOptions?.timeoutMs ?? budget.providerTimeoutMs,
    retries: input.fanoutOptions?.retries ?? 1,
    backoffMs: input.fanoutOptions?.backoffMs ?? 200,
  };
  const coordinator =
    input.models.find((m) => m.id === input.coordinatorModelId) ??
    input.models[0];
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
  }

  const finalClaims = resolveFinalClaims(proposals, revisions);
  const claimsById = new Map(finalClaims.map((c) => [c.claim_id, c]));

  // --- Normalize (single coordinator call) ---
  assertWithinCostLimit("normalize");
  emit("phase_started", "normalize");
  t0 = Date.now();
  let normalize: NormalizeResult;
  try {
    normalize = await structuredCall(
      input.provider,
      coordinator,
      buildNormalizePrompt({
        question: input.question,
        claims: finalClaims,
      }),
      NormalizeResultSchema,
      (usage) => recordUsage(costState, usage),
      itemStreamHooks(emit, "normalize", coordinator.id, fanout.timeoutMs)
    );
  } catch (err) {
    const message = describeCoordinatorFailure(err, "归一");
    emit("run_failed", "normalize", { message });
    throw new Error(message);
  }
  timings.normalize = Date.now() - t0;
  emit("phase_completed", "normalize", {
    count: normalize.candidate_claims.length,
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
    if (!voteOutcome.quorum.met) {
      const failures = describeFailures(voteOutcome);
      emit("run_failed", "vote", { quorum: voteOutcome.quorum, failures });
      throw new DeliberationQuorumError("vote", voteOutcome.quorum, failures);
    }
    votes = voteOutcome.succeeded.map((s) => stampVoteSet(s.config, s.value));
    emit("phase_completed", "vote", {
      count: votes.length,
      partial: voteOutcome.quorum.partial,
      failures: describeFailures(voteOutcome),
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
      }
    );
  } catch (err) {
    const message = describeCoordinatorFailure(err, "合成");
    emit("run_failed", "compose", { message });
    throw new Error(message);
  }
  timings.compose = Date.now() - t0;
  emit("phase_completed", "compose");

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
      itemStreamHooks(emit, "normalize", coordinator.id, fanout.timeoutMs)
    );
  } catch (err) {
    // 拆题-per-topic 的 normalize 失败会被外层 Promise.allSettled 捕获并
    // 计入 failedTopics（已带 phase_completed/failed:true 上报），这里只需
    // 把裸 AbortError 文案改写得更友好，不需要重复 emit run_failed。
    throw new Error(describeCoordinatorFailure(err, `归一 · ${topic.title}`));
  }
  timings.normalize = Date.now() - t0;
  emit("phase_completed", "normalize", {
    count: normalize.candidate_claims.length,
  });

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
  if (!voteOutcome.quorum.met) {
    const failures = describeFailures(voteOutcome);
    emit("run_failed", "vote", { quorum: voteOutcome.quorum, failures });
    throw new DeliberationQuorumError("vote", voteOutcome.quorum, failures);
  }
  const votes = voteOutcome.succeeded.map((s) => stampVoteSet(s.config, s.value));
  emit("phase_completed", "vote", {
    count: votes.length,
    partial: voteOutcome.quorum.partial,
    failures: describeFailures(voteOutcome),
  });

  const ballotMap = ballotsByCandidate(votes);
  const classifications: Record<string, ClassifyCandidateResult> = {};
  for (const candidate of normalize.candidate_claims) {
    classifications[candidate.candidate_id] = classifyCandidate({
      ballotsForCandidate: ballotMap.get(candidate.candidate_id) ?? [],
      expectedVoterCount: models.length,
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
    timings,
    quorum,
  };
}

async function runPlanningDeliberation(
  input: DeliberationInput
): Promise<DeliberationResult> {
  const runId = input.runId ?? makeRunId();
  const budget = getBudget("planning");
  const fanout = {
    timeoutMs: input.fanoutOptions?.timeoutMs ?? budget.providerTimeoutMs,
    retries: input.fanoutOptions?.retries ?? 1,
    backoffMs: input.fanoutOptions?.backoffMs ?? 200,
  };
  const coordinator =
    input.models.find((m) => m.id === input.coordinatorModelId) ??
    input.models[0];
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
      (usage) => recordUsage(costState, usage)
    );
  } catch (err) {
    const message = describeCoordinatorFailure(err, "拆题");
    emit("run_failed", undefined, { step: "outline", message });
    throw new Error(message);
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

  // --- Section compose, per topic, in parallel ---
  assertWithinCostLimit("section_compose");
  const sections: SectionAnswer[] = await Promise.all(
    topics.map(async (topicResult) => {
      const buckets = computeConsensusBuckets(
        topicResult.normalize,
        topicResult.classifications
      );
      const positionChanges = computePositionChanges(
        topicResult.proposals,
        topicResult.revisions
      );
      const sectionStart = Date.now();
      let section: SectionAnswer;
      try {
        section = await structuredCall(
          input.provider,
          coordinator,
          buildSectionComposePrompt({
            question: input.question,
            topic: topicResult.topic,
            strongConsensus: buckets.strongConsensus,
            qualifiedConsensus: buckets.qualifiedConsensus,
            disputed: buckets.disputed,
            rejected: buckets.rejected,
            positionChanges,
          }),
          SectionAnswerSchema,
          (usage) => recordUsage(costState, usage),
          {
            onDelta: makeTokenStreamHandler(emit, "compose", "section_answer", {
              topicId: topicResult.topic.topic_id,
            }),
            timeoutMs: fanout.timeoutMs,
          }
        );
      } catch (err) {
        const message = describeCoordinatorFailure(
          err,
          `合成 · ${topicResult.topic.title}`
        );
        emit("run_failed", undefined, {
          step: "section_compose",
          topicId: topicResult.topic.topic_id,
          message,
        });
        throw new Error(message);
      }
      topicResult.timings.compose = Date.now() - sectionStart;
      return stampSectionAnswer(topicResult.topic, section);
    })
  );

  // Deterministic assembly from each section's tldr — never a fresh
  // cross-topic model call, which would re-introduce compose acting as a
  // judge across topics (see docs/protocol.md 4.1/4.3).
  const executiveSummary = sections.map((s) => s.tldr).join("\n");
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
    outputFormat: input.outputFormat,
    userOutput,
    userOutputError,
  };
}

import {
  ProposalSchema,
  CritiqueSchema,
  RevisionSetSchema,
  NormalizeResultSchema,
  VoteSetSchema,
  FinalAnswerSchema,
  OutlineResultSchema,
  SectionAnswerSchema,
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
  type ModelProvider,
  type ModelConfig,
  type CompletionRequest,
  type FanoutOutcome,
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
  type ReviewWithReviewer,
  type PositionChangeInput,
} from "@mmd/prompts";
import type { z } from "zod";

export type RunEventType =
  | "run_started"
  | "phase_started"
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
  models: ModelConfig[];
  provider: ModelProvider;
  mode?: RunMode;
  /** Model used for the single-authority normalize/compose calls. Defaults to models[0]. */
  coordinatorModelId?: string;
  fanoutOptions?: { timeoutMs?: number; retries?: number; backoffMs?: number };
  onEvent?: (event: RunEvent) => void;
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
  // v0.2 planning mode only. standard/quick mode leaves these undefined and
  // the flat fields above (proposals/normalize/votes/final/...) populated as
  // before; planning mode leaves the flat fields as harmless empty
  // placeholders (final.final_answer mirrors planDocument.executive_summary)
  // and puts the real per-topic data here instead.
  outline?: OutlineResult;
  topics?: TopicResult[];
  planDocument?: PlanDocument;
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

async function structuredCall<T>(
  provider: ModelProvider,
  config: ModelConfig,
  request: CompletionRequest,
  schema: z.ZodType<T, z.ZodTypeDef, any>
): Promise<T> {
  return callStructured(async (repairNote) => {
    const req: CompletionRequest = repairNote
      ? { ...request, userPrompt: `${request.userPrompt}\n\n${repairNote}` }
      : request;
    return provider.complete(config, req);
  }, schema);
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
  const runId = makeRunId();
  const mode = input.mode ?? "standard";
  const budget = getBudget(mode);
  const fanout = {
    // Defaults to the run's own p95 budget rather than an arbitrary constant —
    // reasoning models can easily take 30-60s+ on a real structured-output
    // prompt, so a flat 15s (fine for MockProvider) was timing out real calls.
    timeoutMs: input.fanoutOptions?.timeoutMs ?? budget.targetP95Ms,
    retries: input.fanoutOptions?.retries ?? 1,
    backoffMs: input.fanoutOptions?.backoffMs ?? 200,
  };
  const coordinator =
    input.models.find((m) => m.id === input.coordinatorModelId) ??
    input.models[0];

  const timings: Partial<Record<Phase, number>> = {};
  const quorum: Partial<Record<Phase, QuorumCheck>> = {};

  const emit = (type: RunEventType, phase?: Phase, data?: unknown) =>
    input.onEvent?.({
      type,
      phase,
      runId,
      timestamp: new Date().toISOString(),
      data,
    });

  emit("run_started", undefined, { question: input.question, mode });

  // --- Propose (always runs) ---
  emit("phase_started", "propose");
  let t0 = Date.now();
  const proposeOutcome = await fanOutWithQuorum(
    input.models,
    (config) =>
      structuredCall(
        input.provider,
        config,
        buildProposePrompt({ question: input.question, modelId: config.id }),
        ProposalSchema
      ),
    fanout
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
    emit("phase_started", "critique");
    t0 = Date.now();
    const critiqueOutcome = await fanOutWithQuorum(
      input.models,
      (config) =>
        structuredCall(
          input.provider,
          config,
          buildCritiquePrompt({
            question: input.question,
            reviewerModelId: config.id,
            proposals,
          }),
          CritiqueSchema
        ),
      fanout
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
    emit("phase_started", "revise");
    t0 = Date.now();
    const reviseOutcome = await fanOutWithQuorum(
      input.models,
      (config) =>
        structuredCall(
          input.provider,
          config,
          buildRevisePrompt({
            question: input.question,
            modelId: config.id,
            ownClaims:
              proposals.find((p) => p.model_id === config.id)?.claims ?? [],
            reviewsOnMine: reviewsForModel(config.id, proposals, critiques),
          }),
          RevisionSetSchema
        ),
      fanout
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
  emit("phase_started", "normalize");
  t0 = Date.now();
  const normalize = await structuredCall(
    input.provider,
    coordinator,
    buildNormalizePrompt({
      question: input.question,
      claims: finalClaims,
    }),
    NormalizeResultSchema
  );
  timings.normalize = Date.now() - t0;
  emit("phase_completed", "normalize", {
    count: normalize.candidate_claims.length,
  });

  // --- Vote (optional per budget) ---
  let votes: VoteSet[] = [];
  if (budget.phases.includes("vote")) {
    emit("phase_started", "vote");
    t0 = Date.now();
    const voteOutcome = await fanOutWithQuorum(
      input.models,
      (config) =>
        structuredCall(
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
          VoteSetSchema
        ),
      fanout
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
  emit("phase_started", "compose");
  t0 = Date.now();
  const final = await structuredCall(
    input.provider,
    coordinator,
    buildComposePrompt({
      question: input.question,
      strongConsensus,
      qualifiedConsensus,
      disputed,
      rejected,
      positionChanges,
    }),
    FinalAnswerSchema
  );
  timings.compose = Date.now() - t0;
  emit("phase_completed", "compose");

  emit("run_completed", undefined, { runId });

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
  };
}

interface RunTopicDeliberationParams {
  runId: string;
  question: string;
  models: ModelConfig[];
  provider: ModelProvider;
  topic: Topic;
  coordinator: ModelConfig;
  fanout: { timeoutMs: number; retries: number; backoffMs: number };
  onEvent?: (event: RunEvent) => void;
}

/** v0.2 planning mode: the same propose->critique->revise->normalize->vote->classify
 * sequence as runStandardOrQuickDeliberation, scoped to one outline topic. Always
 * runs the full phase set (no quick-mode-style skipping) since planning mode's
 * whole point is bounded-but-thorough per-topic deliberation. */
async function runTopicDeliberation(
  params: RunTopicDeliberationParams
): Promise<TopicResult> {
  const { runId, question, models, provider, topic, coordinator, fanout, onEvent } =
    params;

  const timings: Partial<Record<Phase, number>> = {};
  const quorum: Partial<Record<Phase, QuorumCheck>> = {};

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

  emit("phase_started", "propose");
  let t0 = Date.now();
  const proposeOutcome = await fanOutWithQuorum(
    models,
    (config) =>
      structuredCall(
        provider,
        config,
        buildProposePrompt({ question, modelId: config.id, topic }),
        ProposalSchema
      ),
    fanout
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

  emit("phase_started", "critique");
  t0 = Date.now();
  const critiqueOutcome = await fanOutWithQuorum(
    models,
    (config) =>
      structuredCall(
        provider,
        config,
        buildCritiquePrompt({
          question,
          reviewerModelId: config.id,
          proposals,
          topic,
        }),
        CritiqueSchema
      ),
    fanout
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

  emit("phase_started", "revise");
  t0 = Date.now();
  const reviseOutcome = await fanOutWithQuorum(
    models,
    (config) =>
      structuredCall(
        provider,
        config,
        buildRevisePrompt({
          question,
          modelId: config.id,
          ownClaims:
            proposals.find((p) => p.model_id === config.id)?.claims ?? [],
          reviewsOnMine: reviewsForModel(config.id, proposals, critiques),
        }),
        RevisionSetSchema
      ),
    fanout
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

  emit("phase_started", "normalize");
  t0 = Date.now();
  const normalize = await structuredCall(
    provider,
    coordinator,
    buildNormalizePrompt({ question, claims: finalClaims, topic }),
    NormalizeResultSchema
  );
  timings.normalize = Date.now() - t0;
  emit("phase_completed", "normalize", {
    count: normalize.candidate_claims.length,
  });

  emit("phase_started", "vote");
  t0 = Date.now();
  const voteOutcome = await fanOutWithQuorum(
    models,
    (config) =>
      structuredCall(
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
        VoteSetSchema
      ),
    fanout
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
  const runId = makeRunId();
  const budget = getBudget("planning");
  const fanout = {
    timeoutMs: input.fanoutOptions?.timeoutMs ?? budget.targetP95Ms,
    retries: input.fanoutOptions?.retries ?? 1,
    backoffMs: input.fanoutOptions?.backoffMs ?? 200,
  };
  const coordinator =
    input.models.find((m) => m.id === input.coordinatorModelId) ??
    input.models[0];

  const emit = (type: RunEventType, phase?: Phase, data?: unknown) =>
    input.onEvent?.({
      type,
      phase,
      runId,
      timestamp: new Date().toISOString(),
      data,
    });

  emit("run_started", undefined, { question: input.question, mode: "planning" });

  // --- Outline (single coordinator call — see docs/protocol.md for why this
  // doesn't need the multi-model treatment normalize does) ---
  emit("phase_started", undefined, { step: "outline" });
  const outlineStart = Date.now();
  const outline = await structuredCall(
    input.provider,
    coordinator,
    buildOutlinePrompt({ question: input.question, maxTopics: budget.maxTopics }),
    OutlineResultSchema
  );
  emit("phase_completed", undefined, {
    step: "outline",
    count: outline.topics.length,
    timeMs: Date.now() - outlineStart,
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
        models: input.models,
        provider: input.provider,
        topic,
        coordinator,
        fanout,
        onEvent: input.onEvent,
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
    throw new Error(
      `planning mode: all ${outline.topics.length} topic(s) failed — ${detail}`
    );
  }

  // --- Section compose, per topic, in parallel ---
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
      const section = await structuredCall(
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
        SectionAnswerSchema
      );
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

  emit("run_completed", undefined, {
    runId,
    topicCount: topics.length,
    failedTopics,
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
    outline,
    topics,
    planDocument,
  };
}

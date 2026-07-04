import {
  ProposalSchema,
  CritiqueSchema,
  RevisionSetSchema,
  NormalizeResultSchema,
  VoteSetSchema,
  FinalAnswerSchema,
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
} from "@mmd/protocol";
import {
  fanOutWithQuorum,
  callStructured,
  type ModelProvider,
  type ModelConfig,
  type CompletionRequest,
} from "@mmd/model-adapters";
import {
  buildProposePrompt,
  buildCritiquePrompt,
  buildRevisePrompt,
  buildNormalizePrompt,
  buildVotePrompt,
  buildComposePrompt,
  type ReviewWithReviewer,
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

export class DeliberationQuorumError extends Error {
  constructor(
    public readonly phase: Phase,
    public readonly quorum: QuorumCheck
  ) {
    super(
      `phase "${phase}" did not meet quorum: ${quorum.respondentCount}/${quorum.required} required responses`
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
  const runId = makeRunId();
  const mode = input.mode ?? "standard";
  const budget = getBudget(mode);
  const fanout = {
    timeoutMs: input.fanoutOptions?.timeoutMs ?? 15_000,
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
    emit("run_failed", "propose", { quorum: proposeOutcome.quorum });
    throw new DeliberationQuorumError("propose", proposeOutcome.quorum);
  }
  const proposals = proposeOutcome.succeeded.map((s) => s.value);
  emit("phase_completed", "propose", {
    count: proposals.length,
    partial: proposeOutcome.quorum.partial,
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
      emit("run_failed", "critique", { quorum: critiqueOutcome.quorum });
      throw new DeliberationQuorumError("critique", critiqueOutcome.quorum);
    }
    critiques = critiqueOutcome.succeeded.map((s) => s.value);
    emit("phase_completed", "critique", {
      count: critiques.length,
      partial: critiqueOutcome.quorum.partial,
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
      emit("run_failed", "revise", { quorum: reviseOutcome.quorum });
      throw new DeliberationQuorumError("revise", reviseOutcome.quorum);
    }
    revisions = reviseOutcome.succeeded.map((s) => s.value);
    emit("phase_completed", "revise", {
      count: revisions.length,
      partial: reviseOutcome.quorum.partial,
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
      emit("run_failed", "vote", { quorum: voteOutcome.quorum });
      throw new DeliberationQuorumError("vote", voteOutcome.quorum);
    }
    votes = voteOutcome.succeeded.map((s) => s.value);
    emit("phase_completed", "vote", {
      count: votes.length,
      partial: voteOutcome.quorum.partial,
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

  const strongConsensus: string[] = [];
  const qualifiedConsensus: string[] = [];
  const disputed: string[] = [];
  const rejected: string[] = [];
  for (const candidate of normalize.candidate_claims) {
    const label = classifications[candidate.candidate_id].label;
    if (label === "strong_consensus") strongConsensus.push(candidate.text);
    else if (label === "qualified_consensus") qualifiedConsensus.push(candidate.text);
    else if (label === "disputed") disputed.push(candidate.text);
    else rejected.push(candidate.text);
  }

  const positionChanges = revisions.flatMap((set) =>
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
            r.revised_text ?? (r.decision === "withdraw" ? "(withdrawn)" : "(adopted another model's claim)"),
          reason: r.reason_for_change,
        };
      })
  );

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

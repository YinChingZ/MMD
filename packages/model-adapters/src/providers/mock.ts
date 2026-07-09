import type {
  CompletionRequest,
  CompletionResult,
  ModelConfig,
  ModelProvider,
} from "../provider.js";
import { sleep } from "../resilience.js";

export interface MockProviderOptions {
  /** Model ids that should always fail — used to exercise quorum/degradation paths without real API errors. */
  failModelIds?: Set<string>;
  latencyMs?: number;
  /**
   * Deterministic fake USD cost reported per call via CompletionResult.usage.
   * Defaults to a tiny non-zero amount so cost-accumulation logic has
   * something real to sum, without ever tripping a sane cost limit by
   * accident. Tests exercising the M5.1 circuit breaker set this higher to
   * make a run cross a low costLimitUsd deterministically, without needing a
   * real API key (mirrors failModelIds' role for quorum testing).
   */
  costPerCallUsd?: number;
  /**
   * M6.3/M6.4: opt-in only — when unset/false, `completeStream` is never
   * attached to the instance at all (not just a no-op), so every call
   * site's `provider.completeStream` check correctly falls back to
   * `complete()` and every existing test's assumptions about `complete()`
   * call counts stay intact.
   */
  streaming?: boolean;
  /** Characters per onDelta chunk when streaming is enabled. */
  streamChunkSize?: number;
}

/**
 * Deterministic, no-API-key-required provider. Lets the CLI orchestrator's
 * pipeline mechanics (fan-out, quorum, retry, structured-output validation,
 * consensus classification, traceability) be exercised end-to-end before any
 * real model provider key is wired in (M1 acceptance criteria).
 *
 * MockProvider reads `request.meta.phase` and returns schema-shaped JSON for
 * that phase — it never parses prompt text, so it stays decoupled from
 * whatever wording packages/prompts uses.
 */
export class MockProvider implements ModelProvider {
  readonly name = "mock";
  completeStream?: ModelProvider["completeStream"];

  constructor(private readonly opts: MockProviderOptions = {}) {
    if (opts.streaming) {
      this.completeStream = this.streamComplete.bind(this);
    }
  }

  async complete(
    config: ModelConfig,
    request: CompletionRequest
  ): Promise<CompletionResult> {
    const start = Date.now();
    if (this.opts.failModelIds?.has(config.id)) {
      throw new Error(`mock provider: simulated failure for model "${config.id}"`);
    }
    await sleep(this.opts.latencyMs ?? 5);
    const text = JSON.stringify(generate(config, request));
    return { text, latencyMs: Date.now() - start, usage: this.usageFor(request, text) };
  }

  private async streamComplete(
    config: ModelConfig,
    request: CompletionRequest,
    onDelta: (delta: string) => void
  ): Promise<CompletionResult> {
    const start = Date.now();
    if (this.opts.failModelIds?.has(config.id)) {
      throw new Error(`mock provider: simulated failure for model "${config.id}"`);
    }
    const text = JSON.stringify(generate(config, request));
    const chunkSize = this.opts.streamChunkSize ?? 12;
    for (let i = 0; i < text.length; i += chunkSize) {
      onDelta(text.slice(i, i + chunkSize));
      await sleep(1);
    }
    return { text, latencyMs: Date.now() - start, usage: this.usageFor(request, text) };
  }

  private usageFor(request: CompletionRequest, text: string) {
    const promptTokens = Math.ceil(request.userPrompt.length / 4);
    const completionTokens = Math.ceil(text.length / 4);
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd: this.opts.costPerCallUsd ?? 0.0001,
    };
  }
}

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function generate(config: ModelConfig, request: CompletionRequest): unknown {
  const phase = request.meta.phase as string;
  switch (phase) {
    case "propose":
      return mockProposal(config, request);
    case "critique":
      return mockCritique(config, request);
    case "revise":
      return mockRevision(config, request);
    case "normalize":
      return mockNormalize(request);
    case "vote":
      return mockVote(config, request);
    case "compose":
      return mockCompose(request);
    case "outline":
      return mockOutline(request);
    case "section_compose":
      return mockSectionCompose(request);
    default:
      throw new Error(`mock provider: unknown phase "${phase}"`);
  }
}

function mockProposal(config: ModelConfig, request: CompletionRequest) {
  const question = String(request.meta.question ?? "");
  const seed = hash(config.id + question);
  const claims = [1, 2].map((n) => {
    const confidence = Math.min(0.55 + ((seed + n) % 4) * 0.1, 0.95);
    return {
      claim_id: `${config.id}_c${n}`,
      text: `[${config.id}] claim ${n} on: ${question}`,
      type: n === 1 ? "fact" : "recommendation",
      confidence,
      rationale: `Derived from ${config.id}'s independent analysis of the question.`,
      conditions: [],
    };
  });
  return {
    model_id: config.id,
    answer_summary: `${config.id}'s independent take on: ${question}`,
    claims,
    assumptions: [],
    risks: [],
  };
}

interface CritiqueTarget {
  claim_id: string;
  text: string;
  model_id: string;
}

function mockCritique(config: ModelConfig, request: CompletionRequest) {
  const targets = (request.meta.targets as CritiqueTarget[]) ?? [];
  const reviews = targets
    .filter((t) => t.model_id !== config.id)
    .map((t) => {
      const seed = hash(config.id + t.claim_id) % 10;
      const stance = seed < 6 ? "support" : seed < 9 ? "refine" : "challenge";
      const severity = stance === "challenge" && seed === 9 ? "major" : "minor";
      return {
        target_claim_id: t.claim_id,
        stance,
        severity,
        comment:
          stance === "support"
            ? `${config.id} agrees with this claim.`
            : stance === "refine"
              ? `${config.id} thinks this needs a minor qualification.`
              : `${config.id} disagrees with this claim's framing.`,
        ...(stance !== "support"
          ? { suggested_revision: `${t.text} (with ${config.id}'s caveat)` }
          : {}),
      };
    });
  return { reviewer_model_id: config.id, reviews };
}

interface ReviewForRevise {
  reviewer_model_id: string;
  target_claim_id: string;
  stance: string;
}

function mockRevision(config: ModelConfig, request: CompletionRequest) {
  const ownClaims =
    (request.meta.ownClaims as { claim_id: string; text: string }[]) ?? [];
  const reviews = (request.meta.reviews as ReviewForRevise[]) ?? [];

  const revisions = ownClaims.map((claim) => {
    const relevant = reviews.filter((r) => r.target_claim_id === claim.claim_id);
    const hasChallenge = relevant.some((r) => r.stance === "challenge");
    const hasRefine = relevant.some((r) => r.stance === "refine");
    const influencedBy = relevant.map(
      (r, i) => `${r.reviewer_model_id}_review_${i}`
    );

    if (hasChallenge) {
      return {
        original_claim_id: claim.claim_id,
        decision: "revise",
        revised_text: `${claim.text} (revised after challenge)`,
        confidence: 0.6,
        reason_for_change: `${config.id} was persuaded by a challenge and narrowed the claim.`,
        influenced_by: influencedBy,
      };
    }
    if (hasRefine) {
      return {
        original_claim_id: claim.claim_id,
        decision: "revise",
        revised_text: `${claim.text} (with added condition)`,
        confidence: 0.75,
        reason_for_change: `${config.id} added a qualifying condition based on peer feedback.`,
        influenced_by: influencedBy,
      };
    }
    return {
      original_claim_id: claim.claim_id,
      decision: "keep",
      confidence: 0.85,
      reason_for_change: `${config.id} found no persuasive objections and kept the claim.`,
      influenced_by: influencedBy,
    };
  });

  return { model_id: config.id, revisions };
}

interface ClaimForNormalize {
  claim_id: string;
  text: string;
}

function mockNormalize(request: CompletionRequest) {
  const claims = (request.meta.claims as ClaimForNormalize[]) ?? [];
  const candidate_claims = claims.map((c, i) => ({
    candidate_id: `cc_${i + 1}`,
    text: c.text,
    source_claim_ids: [c.claim_id],
    notes: "mock normalize: 1:1 passthrough, no semantic merge",
  }));
  return { candidate_claims };
}

interface CandidateForVote {
  candidate_id: string;
  text: string;
}

function mockVote(config: ModelConfig, request: CompletionRequest) {
  const candidates = (request.meta.candidates as CandidateForVote[]) ?? [];
  const votes = candidates.map((c) => {
    const seed = hash(config.id + c.candidate_id) % 10;
    if (seed < 7) {
      return {
        candidate_id: c.candidate_id,
        vote: "approve",
        confidence: 0.8,
        reason: `${config.id} finds this well-supported.`,
      };
    }
    if (seed < 9) {
      return {
        candidate_id: c.candidate_id,
        vote: "approve_with_conditions",
        confidence: 0.7,
        reason: `${config.id} approves but wants a caveat noted.`,
        required_condition: "Should be caveated as context-dependent.",
      };
    }
    return {
      candidate_id: c.candidate_id,
      vote: "object",
      confidence: 0.6,
      reason: `${config.id} thinks this is not well-supported.`,
      objection_severity: "minor",
    };
  });
  return { model_id: config.id, votes };
}

interface PositionChangeMeta {
  model_id: string;
  changed_from: string;
  changed_to: string;
  reason: string;
}

interface ConsensusBuckets {
  strong: string[];
  qualified: string[];
  disputed: string[];
  rejected: string[];
}

function readConsensusBuckets(request: CompletionRequest): ConsensusBuckets {
  return {
    strong: (request.meta.strongConsensus as string[]) ?? [],
    qualified: (request.meta.qualifiedConsensus as string[]) ?? [],
    disputed: (request.meta.disputed as string[]) ?? [],
    rejected: (request.meta.rejected as string[]) ?? [],
  };
}

function computeConsensusStrength({
  strong,
  qualified,
  disputed,
}: ConsensusBuckets): "high" | "medium" | "low" {
  if (strong.length >= qualified.length + disputed.length) return "high";
  if (disputed.length > strong.length + qualified.length) return "low";
  return "medium";
}

function buildAnswerText(
  intro: string,
  { strong, qualified, disputed }: ConsensusBuckets
): string {
  return (
    [
      intro,
      strong.length ? `Main conclusions: ${strong.join(" ")}` : undefined,
      qualified.length
        ? `Conditional conclusions: ${qualified.join(" ")}`
        : undefined,
      disputed.length ? `Open disputes: ${disputed.join(" ")}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n") || `No consensus reached. ${intro}`
  );
}

function mockCompose(request: CompletionRequest) {
  const question = String(request.meta.question ?? "");
  const buckets = readConsensusBuckets(request);
  const positionChanges =
    (request.meta.positionChanges as PositionChangeMeta[]) ?? [];

  return {
    final_answer: buildAnswerText(`Regarding: ${question}`, buckets),
    strong_consensus: buckets.strong,
    qualified_consensus: buckets.qualified,
    disputed_points: buckets.disputed,
    rejected_or_unsupported: buckets.rejected,
    model_position_changes: positionChanges,
    confidence_summary: {
      consensus_strength: computeConsensusStrength(buckets),
      notes: `${buckets.strong.length} strong, ${buckets.qualified.length} qualified, ${buckets.disputed.length} disputed, ${buckets.rejected.length} rejected.`,
    },
  };
}

function mockOutline(request: CompletionRequest) {
  const maxTopics = Number(request.meta.maxTopics ?? 8);
  const topicCount = Math.max(1, Math.min(2, maxTopics));
  const topics = Array.from({ length: topicCount }, (_, i) => ({
    topic_id: `topic_${i + 1}`,
    title: `Topic ${i + 1}`,
    description: `Mock scope for topic ${i + 1}`,
  }));
  return { topics };
}

function mockSectionCompose(request: CompletionRequest) {
  const topicId = String(request.meta.topicId ?? "");
  const topicTitle = String(request.meta.topicTitle ?? "");
  const buckets = readConsensusBuckets(request);
  const positionChanges =
    (request.meta.positionChanges as PositionChangeMeta[]) ?? [];

  return {
    // Real models routinely invent their own (more descriptive) topic_id
    // instead of echoing back the one given in the prompt — this mock
    // deliberately mangles it too, so tests actually exercise the
    // orchestrator's stampSectionAnswer() override rather than passing
    // vacuously because the mock happened to behave.
    topic_id: `mock-renamed-${topicId}`,
    title: topicTitle,
    tldr: `${topicTitle}: ${
      buckets.strong[0] ?? buckets.qualified[0] ?? "no consensus reached"
    }`,
    section_answer: buildAnswerText(`Regarding ${topicTitle}:`, buckets),
    strong_consensus: buckets.strong,
    qualified_consensus: buckets.qualified,
    disputed_points: buckets.disputed,
    rejected_or_unsupported: buckets.rejected,
    model_position_changes: positionChanges,
    confidence_summary: {
      consensus_strength: computeConsensusStrength(buckets),
      notes: `${buckets.strong.length} strong, ${buckets.qualified.length} qualified, ${buckets.disputed.length} disputed, ${buckets.rejected.length} rejected.`,
    },
  };
}

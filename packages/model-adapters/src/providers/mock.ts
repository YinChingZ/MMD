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

  constructor(private readonly opts: MockProviderOptions = {}) {}

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
    return { text, latencyMs: Date.now() - start };
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

function mockCompose(request: CompletionRequest) {
  const question = String(request.meta.question ?? "");
  const strong = (request.meta.strongConsensus as string[]) ?? [];
  const qualified = (request.meta.qualifiedConsensus as string[]) ?? [];
  const disputed = (request.meta.disputed as string[]) ?? [];
  const rejected = (request.meta.rejected as string[]) ?? [];
  const positionChanges =
    (request.meta.positionChanges as PositionChangeMeta[]) ?? [];

  const strength =
    strong.length >= qualified.length + disputed.length
      ? "high"
      : disputed.length > strong.length + qualified.length
        ? "low"
        : "medium";

  const finalAnswer =
    [
      `Regarding: ${question}`,
      strong.length ? `Main conclusions: ${strong.join(" ")}` : undefined,
      qualified.length
        ? `Conditional conclusions: ${qualified.join(" ")}`
        : undefined,
      disputed.length ? `Open disputes: ${disputed.join(" ")}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n") || `No consensus reached on: ${question}`;

  return {
    final_answer: finalAnswer,
    strong_consensus: strong,
    qualified_consensus: qualified,
    disputed_points: disputed,
    rejected_or_unsupported: rejected,
    model_position_changes: positionChanges,
    confidence_summary: {
      consensus_strength: strength,
      notes: `${strong.length} strong, ${qualified.length} qualified, ${disputed.length} disputed, ${rejected.length} rejected.`,
    },
  };
}

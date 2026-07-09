import { describe, expect, it } from "vitest";
import { FinalAnswerSchema, SectionAnswerSchema } from "@mmd/protocol";
import {
  MockProvider,
  type CompletionRequest,
  type CompletionResult,
  type ModelConfig,
  type ModelProvider,
} from "@mmd/model-adapters";
import {
  CostLimitExceededError,
  DeliberationQuorumError,
  runDeliberation,
  type RunEvent,
} from "../src/index.js";

// MockProvider only knows the six fixed protocol phases (keyed off
// `meta.phase`) — it deliberately throws on anything else, so M6.1's
// `meta.step = "format_user_output"` calls need their own stub here rather
// than teaching the shared MockProvider about arbitrary caller schemas.
class FormatAwareMockProvider implements ModelProvider {
  readonly name = "mock-with-format";
  private readonly inner = new MockProvider(this.opts);

  constructor(
    private readonly opts: { costPerCallUsd?: number } = {},
    private readonly formatResponseText: string = JSON.stringify({
      winner: "model_a",
      confidence: "high",
    })
  ) {}

  async complete(
    config: ModelConfig,
    request: CompletionRequest
  ): Promise<CompletionResult> {
    if (request.meta.step === "format_user_output") {
      return {
        text: this.formatResponseText,
        latencyMs: 1,
        usage: {
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
          costUsd: this.opts.costPerCallUsd ?? 0.0001,
        },
      };
    }
    return this.inner.complete(config, request);
  }
}

const decisionSummarySchema = {
  type: "object",
  required: ["winner", "confidence"],
  properties: {
    winner: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  additionalProperties: false,
};

const models = [
  { id: "model_a", provider: "mock" },
  { id: "model_b", provider: "mock" },
  { id: "model_c", provider: "mock" },
];
const question = "Should a small team adopt a monorepo?";

describe("runDeliberation — M1 acceptance criteria", () => {
  it("runs the full standard pipeline end-to-end and produces a schema-valid final answer", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
    });

    expect(FinalAnswerSchema.safeParse(result.final).success).toBe(true);
    expect(result.proposals).toHaveLength(3);
    expect(result.critiques).toHaveLength(3);
    expect(result.revisions).toHaveLength(3);
    expect(result.votes).toHaveLength(3);
    expect(Object.keys(result.timings)).toEqual([
      "propose",
      "critique",
      "revise",
      "normalize",
      "vote",
      "compose",
    ]);
  });

  it("uses a caller-supplied runId instead of generating one, so API callers can know the id before the run settles", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
      runId: "run_caller_supplied",
    });

    expect(result.runId).toBe("run_caller_supplied");
  });

  it("surfaces which models changed their position and why (not just a flat merge)", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
    });

    // Deterministic given MockProvider's hash-based critique stances for these
    // exact model ids and the orchestrator's own "${modelId}::c${i}" claim id
    // scoping: only model_a's first claim draws a (major) challenge from
    // model_c; every other claim is only ever supported.
    expect(result.final.model_position_changes).toHaveLength(1);
    const changedModels = new Set(
      result.final.model_position_changes.map((c) => c.model_id)
    );
    expect(changedModels).toEqual(new Set(["model_a"]));
    for (const change of result.final.model_position_changes) {
      expect(change.changed_from).not.toBe(change.changed_to);
      expect(change.reason.length).toBeGreaterThan(0);
    }
  });

  it("classifies candidates into consensus buckets using traceable candidates", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
    });

    expect(Object.keys(result.classifications)).toEqual(
      result.normalize.candidate_claims.map((c) => c.candidate_id)
    );
    for (const candidate of result.normalize.candidate_claims) {
      expect(candidate.source_claim_ids.length).toBeGreaterThan(0);
    }
    const validLabels = new Set([
      "strong_consensus",
      "qualified_consensus",
      "disputed",
      "rejected",
    ]);
    for (const { label } of Object.values(result.classifications)) {
      expect(validLabels.has(label)).toBe(true);
    }
  });

  it("degrades gracefully when one model fails: quorum met, run completes, marked partial", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider({ failModelIds: new Set(["model_c"]) }),
    });

    expect(result.proposals).toHaveLength(2);
    expect(result.quorum.propose?.met).toBe(true);
    expect(result.quorum.propose?.partial).toBe(true);
    expect(FinalAnswerSchema.safeParse(result.final).success).toBe(true);
  });

  it("fails fast with a typed error when quorum is not met (2 of 3 models down), naming which models failed and why", async () => {
    const run = runDeliberation({
      question,
      models,
      provider: new MockProvider({
        failModelIds: new Set(["model_b", "model_c"]),
      }),
    });
    await expect(run).rejects.toThrow(DeliberationQuorumError);
    try {
      await run;
      expect.unreachable();
    } catch (err) {
      const error = err as DeliberationQuorumError;
      expect(error.phase).toBe("propose");
      expect(error.failures.map((f) => f.modelId).sort()).toEqual([
        "model_b",
        "model_c",
      ]);
      for (const f of error.failures) {
        expect(f.message).toMatch(/simulated failure/);
      }
    }
  });

  it("quick mode skips critique/revise/vote but still classifies via proposal overlap", async () => {
    const result = await runDeliberation({
      question,
      models: models.slice(0, 2),
      provider: new MockProvider(),
      mode: "quick",
    });

    expect(result.critiques).toHaveLength(0);
    expect(result.revisions).toHaveLength(0);
    expect(result.votes).toHaveLength(0);
    expect(result.normalize.candidate_claims.length).toBeGreaterThan(0);
    expect(Object.keys(result.timings)).toEqual([
      "propose",
      "normalize",
      "compose",
    ]);
    expect(FinalAnswerSchema.safeParse(result.final).success).toBe(true);
  });
});

describe("runDeliberation — M6.2 per-model progress events", () => {
  it("standard mode: emits a model_responded event per model for every fan-out phase, none for normalize/compose", async () => {
    const events: RunEvent[] = [];
    await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
      onEvent: (e) => events.push(e),
    });

    const responded = events.filter((e) => e.type === "model_responded");
    expect(responded).toHaveLength(12); // 4 fan-out phases x 3 models

    const phases = new Set(responded.map((e) => e.phase));
    expect(phases).toEqual(new Set(["propose", "critique", "revise", "vote"]));

    for (const event of responded) {
      const data = event.data as {
        modelId: string;
        ok: boolean;
        latencyMs: number;
        total: number;
      };
      expect(models.map((m) => m.id)).toContain(data.modelId);
      expect(data.ok).toBe(true);
      expect(typeof data.latencyMs).toBe("number");
      expect(data.total).toBe(3);
    }
  });

  it("quick mode: only propose fans out, so model_responded is emitted only for propose", async () => {
    const events: RunEvent[] = [];
    await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
      mode: "quick",
      onEvent: (e) => events.push(e),
    });

    const responded = events.filter((e) => e.type === "model_responded");
    expect(responded).toHaveLength(3);
    expect(responded.every((e) => e.phase === "propose")).toBe(true);
  });

  it("a failing model's event carries ok:false and an error message, others stay ok:true", async () => {
    const events: RunEvent[] = [];
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider({ failModelIds: new Set(["model_c"]) }),
      onEvent: (e) => events.push(e),
    });

    expect(FinalAnswerSchema.safeParse(result.final).success).toBe(true);

    const proposeEvents = events.filter(
      (e) => e.type === "model_responded" && e.phase === "propose"
    );
    expect(proposeEvents).toHaveLength(3);
    const failed = proposeEvents.find(
      (e) => (e.data as { modelId: string }).modelId === "model_c"
    );
    expect((failed?.data as { ok: boolean; error?: string }).ok).toBe(false);
    expect((failed?.data as { error?: string }).error).toMatch(/simulated failure/);
    const succeeded = proposeEvents.filter(
      (e) => (e.data as { modelId: string }).modelId !== "model_c"
    );
    expect(succeeded.every((e) => (e.data as { ok: boolean }).ok)).toBe(true);
  });

  it("planning mode: every model_responded event carries its topic's topicId", async () => {
    const events: RunEvent[] = [];
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider(),
      mode: "planning",
      onEvent: (e) => events.push(e),
    });

    const topicIds = new Set((result.topics ?? []).map((t) => t.topic.topic_id));
    const responded = events.filter((e) => e.type === "model_responded");
    expect(responded).toHaveLength(topicIds.size * 4 * 3); // topics x 4 fan-out phases x 3 models
    for (const event of responded) {
      const topicId = (event.data as { topicId?: string }).topicId;
      expect(topicId).toBeDefined();
      expect(topicIds.has(topicId!)).toBe(true);
    }
  });
});

interface ItemProgressData {
  modelId: string;
  arrayField: string;
  index: number;
  item: unknown;
  attempt: number;
  topicId?: string;
}

function itemProgressEvents(events: RunEvent[], phase?: string): ItemProgressData[] {
  return events
    .filter((e) => e.type === "item_progress" && (phase === undefined || e.phase === phase))
    .map((e) => e.data as ItemProgressData);
}

function groupByModel(items: ItemProgressData[]): Map<string, unknown[]> {
  const byModel = new Map<string, unknown[]>();
  for (const ip of items) {
    const arr = byModel.get(ip.modelId) ?? [];
    arr.push(ip.item);
    byModel.set(ip.modelId, arr);
  }
  return byModel;
}

/** RepairRetryMockProvider streams a schema-invalid propose response on the
 * first attempt for a given model (invalid at the whole-Proposal level, e.g.
 * missing answer_summary — but with a claim item that itself validates
 * against ClaimSchema on its own, so it still fires an item_progress event)
 * and a fully valid one on the next attempt, to exercise callStructured's
 * repair-retry loop together with M6.3's `attempt` tagging. All non-propose
 * phases delegate straight through to a streaming MockProvider unchanged. */
class RepairRetryMockProvider implements ModelProvider {
  readonly name = "repair-retry-mock";
  private readonly inner = new MockProvider({ streaming: true, streamChunkSize: 8 });
  private readonly proposeCallCount = new Map<string, number>();

  async complete(config: ModelConfig, request: CompletionRequest): Promise<CompletionResult> {
    return this.inner.complete(config, request);
  }

  async completeStream(
    config: ModelConfig,
    request: CompletionRequest,
    onDelta: (delta: string) => void,
    opts?: { timeoutMs?: number }
  ): Promise<CompletionResult> {
    if (request.meta.phase !== "propose") {
      return this.inner.completeStream!(config, request, onDelta, opts);
    }
    const count = (this.proposeCallCount.get(config.id) ?? 0) + 1;
    this.proposeCallCount.set(config.id, count);
    const start = Date.now();
    const text =
      count === 1
        ? JSON.stringify({
            model_id: config.id,
            // answer_summary deliberately omitted — fails ProposalSchema at
            // the whole-response level, forcing a repair retry — but the
            // claim item below is itself fully ClaimSchema-valid, so it
            // still fires an item_progress event tagged attempt=0.
            claims: [
              {
                claim_id: `${config.id}_attempt0`,
                text: "attempt 0 claim",
                type: "fact",
                confidence: 0.5,
                rationale: "attempt 0 rationale",
                conditions: [],
              },
            ],
          })
        : JSON.stringify({
            model_id: config.id,
            answer_summary: "attempt 1 summary",
            claims: [
              {
                claim_id: `${config.id}_attempt1`,
                text: "attempt 1 claim",
                type: "fact",
                confidence: 0.5,
                rationale: "attempt 1 rationale",
                conditions: [],
              },
            ],
            assumptions: [],
            risks: [],
          });
    for (let i = 0; i < text.length; i += 8) onDelta(text.slice(i, i + 8));
    return {
      text,
      latencyMs: Date.now() - start,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0.0001 },
    };
  }
}

describe("runDeliberation — M6.3 claim/item-level progressive parsing", () => {
  it("standard mode: item_progress fires per model for propose/critique/revise/vote/normalize, matching the final settled result exactly", async () => {
    const events: RunEvent[] = [];
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider({ streaming: true }),
      onEvent: (e) => events.push(e),
    });

    const phasesSeen = new Set(
      events.filter((e) => e.type === "item_progress").map((e) => e.phase)
    );
    expect(phasesSeen).toEqual(new Set(["propose", "critique", "revise", "vote", "normalize"]));

    // Propose previews show the model's raw claim_id/topic_id before the
    // orchestrator's post-validation stamping (stampProposal namespaces
    // claim_id per model and fills in topic_id) — every other field is
    // untouched by stamping, so compare those instead of the full object.
    const proposeByModel = groupByModel(itemProgressEvents(events, "propose"));
    for (const proposal of result.proposals) {
      const previewClaims = proposeByModel.get(proposal.model_id) as {
        text: string;
        type: string;
        confidence: number;
        rationale: string;
        conditions: string[];
      }[];
      expect(previewClaims.map((c) => ({ text: c.text, type: c.type, confidence: c.confidence }))).toEqual(
        proposal.claims.map((c) => ({ text: c.text, type: c.type, confidence: c.confidence }))
      );
    }

    const voteByModel = groupByModel(itemProgressEvents(events, "vote"));
    for (const voteSet of result.votes) {
      expect(voteByModel.get(voteSet.model_id)).toEqual(voteSet.votes);
    }

    const normalizeItems = itemProgressEvents(events, "normalize").map((ip) => ip.item);
    expect(normalizeItems).toEqual(result.normalize.candidate_claims);
  });

  it("quick mode: item_progress fires only for propose and normalize (critique/revise/vote skipped)", async () => {
    const events: RunEvent[] = [];
    await runDeliberation({
      question,
      models,
      provider: new MockProvider({ streaming: true }),
      mode: "quick",
      onEvent: (e) => events.push(e),
    });

    const phasesSeen = new Set(
      events.filter((e) => e.type === "item_progress").map((e) => e.phase)
    );
    expect(phasesSeen).toEqual(new Set(["propose", "normalize"]));
  });

  it("never fires when the provider doesn't support streaming (fully opt-in, regression-proof default)", async () => {
    const events: RunEvent[] = [];
    await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
      onEvent: (e) => events.push(e),
    });

    expect(events.some((e) => e.type === "item_progress")).toBe(false);
  });

  it("attempt tags distinguish an abandoned repair-retry generation's items from the final accepted one", async () => {
    const events: RunEvent[] = [];
    const result = await runDeliberation({
      question,
      models: models.slice(0, 1),
      provider: new RepairRetryMockProvider(),
      onEvent: (e) => events.push(e),
    });

    const proposeItems = itemProgressEvents(events, "propose");
    const attempt0 = proposeItems.filter((ip) => ip.attempt === 0);
    const attempt1 = proposeItems.filter((ip) => ip.attempt === 1);
    expect(attempt0).toHaveLength(1);
    expect(attempt1).toHaveLength(1);
    expect((attempt0[0].item as { claim_id: string }).claim_id).toBe("model_a_attempt0");
    expect((attempt1[0].item as { claim_id: string }).claim_id).toBe("model_a_attempt1");

    // The final, authoritative result only ever reflects the last accepted
    // attempt's content — proving the frontend's "clear and redraw on new
    // attempt" rule (index===0 on a fresh attempt replaces, not appends)
    // matches what the backend actually considers final. (claim_id itself
    // gets rewritten by stampProposal regardless of attempt, so compare
    // `text` instead, which stamping never touches.)
    expect(result.proposals[0].claims.map((c) => c.text)).toEqual(["attempt 1 claim"]);
  });

  it("planning mode: every item_progress event carries its topic's topicId", async () => {
    const events: RunEvent[] = [];
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider({ streaming: true }),
      mode: "planning",
      onEvent: (e) => events.push(e),
    });

    const topicIds = new Set((result.topics ?? []).map((t) => t.topic.topic_id));
    const itemEvents = itemProgressEvents(events);
    expect(itemEvents.length).toBeGreaterThan(0);
    for (const ip of itemEvents) {
      expect(ip.topicId).toBeDefined();
      expect(topicIds.has(ip.topicId!)).toBe(true);
    }
  });
});

interface TokenData {
  delta: string;
  topicId?: string;
}

function tokenEvents(events: RunEvent[]): { phase: string | undefined; data: TokenData }[] {
  return events
    .filter((e) => e.type === "token")
    .map((e) => ({ phase: e.phase, data: e.data as TokenData }));
}

describe("runDeliberation — M6.4 compose-stage token streaming", () => {
  it("standard mode: token events fire only for compose, and concatenating all deltas reconstructs the final answer exactly", async () => {
    const events: RunEvent[] = [];
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider({ streaming: true }),
      onEvent: (e) => events.push(e),
    });

    const tokens = tokenEvents(events);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((t) => t.phase === "compose")).toBe(true);
    const reconstructed = tokens.map((t) => t.data.delta).join("");
    expect(reconstructed).toBe(result.final.final_answer);
  });

  it("never fires when the provider doesn't support streaming (fully opt-in)", async () => {
    const events: RunEvent[] = [];
    await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
      onEvent: (e) => events.push(e),
    });

    expect(events.some((e) => e.type === "token")).toBe(false);
  });

  it("planning mode: section-compose token events carry the correct topicId and reconstruct each topic's section_answer exactly", async () => {
    const events: RunEvent[] = [];
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider({ streaming: true }),
      mode: "planning",
      onEvent: (e) => events.push(e),
    });

    const tokens = tokenEvents(events);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((t) => t.phase === "compose")).toBe(true);

    for (const section of result.planDocument?.sections ?? []) {
      const topicTokens = tokens.filter((t) => t.data.topicId === section.topic_id);
      expect(topicTokens.length).toBeGreaterThan(0);
      const reconstructed = topicTokens.map((t) => t.data.delta).join("");
      expect(reconstructed).toBe(section.section_answer);
    }
  });
});

describe("runDeliberation — v0.2 planning mode", () => {
  it("runs an outline then a full per-topic deliberation, producing a schema-valid plan document", async () => {
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider(),
      mode: "planning",
    });

    // MockProvider's mockOutline deterministically produces 2 topics (capped
    // by PLANNING_BUDGET.maxTopics=8, but MockProvider keeps it small so
    // tests stay fast and assertions can be exact).
    expect(result.outline?.topics).toHaveLength(2);
    expect(result.topics).toHaveLength(2);
    expect(result.planDocument?.sections).toHaveLength(2);

    for (const section of result.planDocument?.sections ?? []) {
      expect(SectionAnswerSchema.safeParse(section).success).toBe(true);
    }

    // executive_summary is a deterministic join of each section's tldr, never
    // a fresh model call — assert it round-trips exactly, not just "exists".
    const expectedSummary = (result.planDocument?.sections ?? [])
      .map((s) => s.tldr)
      .join("\n");
    expect(result.planDocument?.executive_summary).toBe(expectedSummary);
  });

  it("emits the outline's topic_id/title list on its phase_completed event, not just a count", async () => {
    const events: RunEvent[] = [];
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider(),
      mode: "planning",
      onEvent: (e) => events.push(e),
    });

    const outlineCompleted = events.find(
      (e) =>
        e.type === "phase_completed" &&
        (e.data as { step?: string })?.step === "outline"
    );
    expect(outlineCompleted).toBeDefined();
    const data = outlineCompleted?.data as {
      count: number;
      topics: { topic_id: string; title: string }[];
    };
    expect(data.topics).toEqual(
      result.outline?.topics.map((t) => ({ topic_id: t.topic_id, title: t.title }))
    );
  });

  it("overrides a section-compose call's self-reported topic_id with ground truth (found via real-model testing: real models invent their own topic_id instead of echoing the one given)", async () => {
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider(),
      mode: "planning",
    });

    // MockProvider deliberately mangles topic_id in its section_compose
    // response (prefixes with "mock-renamed-") to mimic what real models do.
    // If the orchestrator didn't stamp it back, every section's topic_id
    // would fail to match any TopicResult and format.ts's per-section
    // timings/quorum lookup would silently render nothing.
    const topicIds = (result.topics ?? []).map((t) => t.topic.topic_id);
    const sectionTopicIds = (result.planDocument?.sections ?? []).map(
      (s) => s.topic_id
    );
    expect(sectionTopicIds).toEqual(topicIds);
    for (const id of sectionTopicIds) {
      expect(id.startsWith("mock-renamed-")).toBe(false);
    }
  });

  it("scopes each topic's proposals with model_id and claim ids in the ${topicId}::${modelId}::c{i} format", async () => {
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider(),
      mode: "planning",
    });

    for (const topicResult of result.topics ?? []) {
      for (const proposal of topicResult.proposals) {
        expect(models.map((m) => m.id)).toContain(proposal.model_id);
        for (const claim of proposal.claims) {
          expect(claim.topic_id).toBe(topicResult.topic.topic_id);
          expect(claim.claim_id.startsWith(`${topicResult.topic.topic_id}::`)).toBe(
            true
          );
        }
      }
    }

    // Claim ids from different topics never collide, even though MockProvider
    // assigns the same local claim numbering ("c0", "c1", ...) in every topic.
    const allClaimIds = (result.topics ?? []).flatMap((t) =>
      t.proposals.flatMap((p) => p.claims.map((c) => c.claim_id))
    );
    expect(new Set(allClaimIds).size).toBe(allClaimIds.length);
  });

  it("runs each topic's full six-phase deliberation (critique/revise/vote all present)", async () => {
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider(),
      mode: "planning",
    });

    for (const topicResult of result.topics ?? []) {
      expect(topicResult.critiques).toHaveLength(3);
      expect(topicResult.revisions).toHaveLength(3);
      expect(topicResult.votes).toHaveLength(3);
      expect(Object.keys(topicResult.timings)).toEqual([
        "propose",
        "critique",
        "revise",
        "normalize",
        "vote",
        "compose",
      ]);
    }
  });

  it("fails fast with a clear error when every topic fails quorum", async () => {
    // Every topic uses the same model roster, so a model-wide failure fails
    // every topic's propose phase identically — this exercises the
    // "all topics failed" aggregate error, distinct from a single topic
    // failing on its own (which Promise.allSettled would otherwise tolerate).
    await expect(
      runDeliberation({
        question: "Plan a project",
        models,
        provider: new MockProvider({
          failModelIds: new Set(["model_b", "model_c"]),
        }),
        mode: "planning",
      })
    ).rejects.toThrow(/all \d+ topic\(s\) failed/);
  });
});

describe("runDeliberation — M5.1 cost circuit breaker", () => {
  it("completes normally and reports an accumulated cost when under the limit", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider({ costPerCallUsd: 0.01 }),
      costLimitUsd: 100,
    });

    expect(result.cost.limitUsd).toBe(100);
    expect(result.cost.hasUnknownPricing).toBe(false);
    // 3 models x 6 phases (3 fan-out phases of 3 calls + 2 single-coordinator
    // calls counted once each, normalize/compose) — exact count isn't the
    // point, just that real per-call costs were actually summed, not left at 0.
    expect(result.cost.totalUsd).toBeCloseTo(0.01 * (3 + 3 + 3 + 1 + 3 + 1), 5);
  });

  it("stops the run before finishing all phases once accumulated cost exceeds the limit, without crashing", async () => {
    const events: RunEvent[] = [];
    const run = runDeliberation({
      question,
      models,
      provider: new MockProvider({ costPerCallUsd: 1 }),
      // 3 models x $1 in propose alone already exceeds this — critique should
      // never start.
      costLimitUsd: 2,
      onEvent: (e) => events.push(e),
    });

    await expect(run).rejects.toThrow(CostLimitExceededError);
    await expect(run).rejects.toThrow(/critique/);

    const failedEvent = events.find((e) => e.type === "run_failed");
    expect(failedEvent).toBeDefined();
    expect((failedEvent!.data as any).reason).toBe("cost_limit_exceeded");
    // propose itself always runs (cost is 0 before the first phase) — only
    // the phase after crossing the limit is skipped.
    expect(events.some((e) => e.type === "phase_completed" && e.phase === "propose")).toBe(
      true
    );
    expect(
      events.some((e) => e.type === "phase_started" && e.phase === "critique")
    ).toBe(false);
  });

  it("no costLimitUsd set: never breaks the run regardless of accumulated cost", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider({ costPerCallUsd: 1000 }),
    });
    expect(result.cost.limitUsd).toBeUndefined();
    expect(result.cost.totalUsd).toBeGreaterThan(0);
  });

  it("planning mode: a shared limit across parallel topics stops the whole run and still emits run_failed (fixes a pre-existing gap where an all-topics-failed run never emitted a terminal SSE event)", async () => {
    const events: RunEvent[] = [];
    const run = runDeliberation({
      question: "Plan a project",
      models,
      provider: new MockProvider({ costPerCallUsd: 1 }),
      mode: "planning",
      costLimitUsd: 2,
      onEvent: (e) => events.push(e),
    });

    await expect(run).rejects.toThrow(/cost limit exceeded|all \d+ topic\(s\) failed/);
    expect(events.some((e) => e.type === "run_failed")).toBe(true);
  });
});

describe("runDeliberation — M6.1 user-defined JSON output", () => {
  it("omitting outputFormat leaves behavior unchanged (userOutput/userOutputError both undefined)", async () => {
    const result = await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
    });

    expect(result.outputFormat).toBeUndefined();
    expect(result.userOutput).toBeUndefined();
    expect(result.userOutputError).toBeUndefined();
  });

  it("standard mode: formats the internal FinalAnswer into the caller's JSON Schema after compose", async () => {
    const events: RunEvent[] = [];
    const result = await runDeliberation({
      question,
      models,
      provider: new FormatAwareMockProvider(),
      outputFormat: { name: "DecisionSummary", schema: decisionSummarySchema },
      onEvent: (e) => events.push(e),
    });

    expect(FinalAnswerSchema.safeParse(result.final).success).toBe(true);
    expect(result.userOutputError).toBeUndefined();
    expect(result.userOutput).toEqual({ winner: "model_a", confidence: "high" });

    const formatEvents = events.filter(
      (e) => (e.data as any)?.step === "format_user_output"
    );
    expect(formatEvents.some((e) => e.type === "phase_started")).toBe(true);
    expect(
      formatEvents.some((e) => e.type === "phase_completed" && !(e.data as any).failed)
    ).toBe(true);
  });

  it("planning mode: formats the internal PlanDocument into the caller's JSON Schema", async () => {
    const result = await runDeliberation({
      question: "Plan a project",
      models,
      provider: new FormatAwareMockProvider(),
      mode: "planning",
      outputFormat: { schema: decisionSummarySchema },
    });

    expect(result.planDocument).toBeDefined();
    expect(result.userOutputError).toBeUndefined();
    expect(result.userOutput).toEqual({ winner: "model_a", confidence: "high" });
  });

  it("degrades gracefully when repair retries are exhausted: run still completes with userOutputError set, main result untouched", async () => {
    const events: RunEvent[] = [];
    const result = await runDeliberation({
      question,
      models,
      provider: new FormatAwareMockProvider({}, "not valid json at all"),
      outputFormat: { schema: decisionSummarySchema },
      onEvent: (e) => events.push(e),
    });

    expect(FinalAnswerSchema.safeParse(result.final).success).toBe(true);
    expect(result.userOutput).toBeUndefined();
    expect(result.userOutputError).toMatch(/failed schema validation/);

    const failedFormatEvent = events.find(
      (e) =>
        e.type === "phase_completed" &&
        (e.data as any)?.step === "format_user_output" &&
        (e.data as any)?.failed
    );
    expect(failedFormatEvent).toBeDefined();
  });

  it("the format call's usage is folded into the M5.1 cost total", async () => {
    const withFormat = await runDeliberation({
      question,
      models,
      provider: new FormatAwareMockProvider({ costPerCallUsd: 5 }),
      outputFormat: { schema: decisionSummarySchema },
      costLimitUsd: 1000,
    });
    const withoutFormat = await runDeliberation({
      question,
      models,
      provider: new MockProvider(),
      costLimitUsd: 1000,
    });

    expect(withFormat.cost.totalUsd).toBeGreaterThan(
      withoutFormat.cost.totalUsd + 4
    );
  });
});

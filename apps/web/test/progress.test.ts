import { describe, expect, it } from "vitest";
import { deriveRunProgress } from "../src/lib/progress";
import type { RunEventMessage } from "../src/lib/run-events";

function event(partial: Partial<RunEventMessage>): RunEventMessage {
  return {
    seq: 0,
    type: "phase_started",
    phase: null,
    topicId: null,
    data: {},
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("deriveRunProgress — standard/quick mode", () => {
  it("marks phases in_progress then done as matching events arrive", () => {
    const events = [
      event({ seq: 1, type: "phase_started", phase: "propose" }),
      event({ seq: 2, type: "phase_completed", phase: "propose" }),
      event({ seq: 3, type: "phase_started", phase: "critique" }),
    ];
    const progress = deriveRunProgress(events, "standard");
    expect(progress.kind).toBe("flat");
    if (progress.kind !== "flat") throw new Error("expected flat");
    expect(progress.phases.propose).toBe("done");
    expect(progress.phases.critique).toBe("in_progress");
    expect(progress.phases.vote).toBeUndefined();
  });

  it("marks a phase failed on run_failed", () => {
    const events = [event({ type: "run_failed", phase: "vote" })];
    const progress = deriveRunProgress(events, "standard");
    if (progress.kind !== "flat") throw new Error("expected flat");
    expect(progress.phases.vote).toBe("failed");
  });

  it("accumulates model_responded events into modelProgress for the current phase", () => {
    const events = [
      event({ seq: 1, type: "phase_started", phase: "propose" }),
      event({
        seq: 2,
        type: "model_responded",
        phase: "propose",
        data: { modelId: "model_a", ok: true, latencyMs: 120, total: 3 },
      }),
      event({
        seq: 3,
        type: "model_responded",
        phase: "propose",
        data: { modelId: "model_b", ok: false, latencyMs: 50, total: 3 },
      }),
    ];
    const progress = deriveRunProgress(events, "standard");
    if (progress.kind !== "flat") throw new Error("expected flat");
    expect(progress.modelProgress.propose?.total).toBe(3);
    expect(progress.modelProgress.propose?.responded).toEqual([
      { modelId: "model_a", ok: true, latencyMs: 120 },
      { modelId: "model_b", ok: false, latencyMs: 50 },
    ]);
  });

  it("resets modelProgress when a phase restarts", () => {
    const events = [
      event({ seq: 1, type: "phase_started", phase: "propose" }),
      event({
        seq: 2,
        type: "model_responded",
        phase: "propose",
        data: { modelId: "model_a", ok: true, latencyMs: 10, total: 3 },
      }),
      event({ seq: 3, type: "phase_started", phase: "propose" }),
    ];
    const progress = deriveRunProgress(events, "standard");
    if (progress.kind !== "flat") throw new Error("expected flat");
    expect(progress.modelProgress.propose?.responded).toEqual([]);
  });

  it("appends item_progress items (index > 0) to the same model's list", () => {
    const events = [
      event({ seq: 1, type: "phase_started", phase: "propose" }),
      event({
        seq: 2,
        type: "item_progress",
        phase: "propose",
        data: { modelId: "model_a", arrayField: "claims", index: 0, item: { claim_id: "c0" }, attempt: 0 },
      }),
      event({
        seq: 3,
        type: "item_progress",
        phase: "propose",
        data: { modelId: "model_a", arrayField: "claims", index: 1, item: { claim_id: "c1" }, attempt: 0 },
      }),
    ];
    const progress = deriveRunProgress(events, "standard");
    if (progress.kind !== "flat") throw new Error("expected flat");
    expect(progress.itemProgress.propose?.model_a).toEqual({
      modelId: "model_a",
      arrayField: "claims",
      items: [{ claim_id: "c0" }, { claim_id: "c1" }],
    });
  });

  it("resets a model's item_progress list when index === 0 arrives again (repair-retry or network-retry restart)", () => {
    const events = [
      event({ seq: 1, type: "phase_started", phase: "propose" }),
      event({
        seq: 2,
        type: "item_progress",
        phase: "propose",
        data: { modelId: "model_a", arrayField: "claims", index: 0, item: { claim_id: "stale" }, attempt: 0 },
      }),
      event({
        seq: 3,
        type: "item_progress",
        phase: "propose",
        data: { modelId: "model_a", arrayField: "claims", index: 0, item: { claim_id: "fresh" }, attempt: 1 },
      }),
    ];
    const progress = deriveRunProgress(events, "standard");
    if (progress.kind !== "flat") throw new Error("expected flat");
    expect(progress.itemProgress.propose?.model_a?.items).toEqual([{ claim_id: "fresh" }]);
  });

  it("clears stale streamed items while a model retries in non-stream mode", () => {
    const events = [
      event({ seq: 1, type: "phase_started", phase: "propose" }),
      event({
        seq: 2,
        type: "item_progress",
        phase: "propose",
        data: { modelId: "model_a", arrayField: "claims", index: 0, item: { claim_id: "stale" }, attempt: 0 },
      }),
      event({
        seq: 3,
        type: "model_attempt",
        phase: "propose",
        data: { modelId: "model_a", attempt: 1, transport: "non_stream" },
      }),
    ];
    const progress = deriveRunProgress(events, "quick");
    if (progress.kind !== "flat") throw new Error("expected flat");
    expect(progress.itemProgress.propose?.model_a).toBeUndefined();
    expect(progress.modelProgress.propose?.retrying).toEqual(["model_a"]);
  });

  it("tracks item_progress independently per model within a phase", () => {
    const events = [
      event({ seq: 1, type: "phase_started", phase: "propose" }),
      event({
        seq: 2,
        type: "item_progress",
        phase: "propose",
        data: { modelId: "model_a", arrayField: "claims", index: 0, item: { claim_id: "a0" }, attempt: 0 },
      }),
      event({
        seq: 3,
        type: "item_progress",
        phase: "propose",
        data: { modelId: "model_b", arrayField: "claims", index: 0, item: { claim_id: "b0" }, attempt: 0 },
      }),
    ];
    const progress = deriveRunProgress(events, "standard");
    if (progress.kind !== "flat") throw new Error("expected flat");
    expect(progress.itemProgress.propose?.model_a?.items).toEqual([{ claim_id: "a0" }]);
    expect(progress.itemProgress.propose?.model_b?.items).toEqual([{ claim_id: "b0" }]);
  });
});

describe("deriveRunProgress — planning mode", () => {
  it("tracks the outline step separately from per-topic phases", () => {
    const events = [
      event({ seq: 1, type: "phase_started", phase: undefined, data: { step: "outline" } }),
      event({ seq: 2, type: "phase_completed", phase: undefined, data: { step: "outline", count: 2 } }),
      event({ seq: 3, type: "phase_started", phase: "propose", topicId: "topic_1" }),
      event({ seq: 4, type: "phase_completed", phase: "propose", topicId: "topic_1" }),
      event({ seq: 5, type: "phase_started", phase: "propose", topicId: "topic_2" }),
    ];
    const progress = deriveRunProgress(events, "planning");
    if (progress.kind !== "planning") throw new Error("expected planning");
    expect(progress.outline).toBe("done");
    expect(progress.topics.get("topic_1")?.phases.propose).toBe("done");
    expect(progress.topics.get("topic_2")?.phases.propose).toBe("in_progress");
  });

  it("backfills topic titles from the outline step's phase_completed event", () => {
    const events = [
      event({
        seq: 1,
        type: "phase_completed",
        phase: undefined,
        data: {
          step: "outline",
          count: 2,
          topics: [
            { topic_id: "topic_1", title: "Backend framework choice" },
            { topic_id: "topic_2", title: "Deployment strategy" },
          ],
        },
      }),
      event({ seq: 2, type: "phase_started", phase: "propose", topicId: "topic_1" }),
    ];
    const progress = deriveRunProgress(events, "planning");
    if (progress.kind !== "planning") throw new Error("expected planning");
    expect(progress.topics.get("topic_1")?.title).toBe("Backend framework choice");
    expect(progress.topics.get("topic_2")?.title).toBe("Deployment strategy");
  });

  it("marks a topic failed without touching other topics", () => {
    const events = [
      event({ type: "phase_completed", phase: undefined, topicId: "topic_1", data: { step: "topic", failed: true, error: "quorum not met" } }),
      event({ type: "phase_started", phase: "propose", topicId: "topic_2" }),
    ];
    const progress = deriveRunProgress(events, "planning");
    if (progress.kind !== "planning") throw new Error("expected planning");
    expect(progress.topics.get("topic_1")?.failed).toBe(true);
    expect(progress.topics.get("topic_1")?.error).toBe("quorum not met");
    expect(progress.topics.get("topic_2")?.failed).toBe(false);
  });

  it("tracks modelProgress independently per topic", () => {
    const events = [
      event({ seq: 1, type: "phase_started", phase: "propose", topicId: "topic_1" }),
      event({
        seq: 2,
        type: "model_responded",
        phase: "propose",
        topicId: "topic_1",
        data: { modelId: "model_a", ok: true, latencyMs: 30, total: 3 },
      }),
      event({ seq: 3, type: "phase_started", phase: "propose", topicId: "topic_2" }),
      event({
        seq: 4,
        type: "model_responded",
        phase: "propose",
        topicId: "topic_2",
        data: { modelId: "model_b", ok: true, latencyMs: 40, total: 3 },
      }),
    ];
    const progress = deriveRunProgress(events, "planning");
    if (progress.kind !== "planning") throw new Error("expected planning");
    expect(progress.topics.get("topic_1")?.modelProgress.propose?.responded).toEqual([
      { modelId: "model_a", ok: true, latencyMs: 30 },
    ]);
    expect(progress.topics.get("topic_2")?.modelProgress.propose?.responded).toEqual([
      { modelId: "model_b", ok: true, latencyMs: 40 },
    ]);
  });

  it("tracks itemProgress independently per topic", () => {
    const events = [
      event({ seq: 1, type: "phase_started", phase: "propose", topicId: "topic_1" }),
      event({
        seq: 2,
        type: "item_progress",
        phase: "propose",
        topicId: "topic_1",
        data: { modelId: "model_a", arrayField: "claims", index: 0, item: { claim_id: "t1" }, attempt: 0 },
      }),
      event({ seq: 3, type: "phase_started", phase: "propose", topicId: "topic_2" }),
      event({
        seq: 4,
        type: "item_progress",
        phase: "propose",
        topicId: "topic_2",
        data: { modelId: "model_a", arrayField: "claims", index: 0, item: { claim_id: "t2" }, attempt: 0 },
      }),
    ];
    const progress = deriveRunProgress(events, "planning");
    if (progress.kind !== "planning") throw new Error("expected planning");
    expect(progress.topics.get("topic_1")?.itemProgress.propose?.model_a?.items).toEqual([
      { claim_id: "t1" },
    ]);
    expect(progress.topics.get("topic_2")?.itemProgress.propose?.model_a?.items).toEqual([
      { claim_id: "t2" },
    ]);
  });
});

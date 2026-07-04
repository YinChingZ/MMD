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
});

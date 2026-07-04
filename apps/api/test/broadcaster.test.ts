import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { PersistedRunEvent } from "../src/repositories/events-repo.js";
import { RunBroadcaster } from "../src/sse/broadcaster.js";

function fakeResponse(): ServerResponse {
  return { write: vi.fn(), end: vi.fn() } as unknown as ServerResponse;
}

function event(overrides: Partial<PersistedRunEvent> = {}): PersistedRunEvent {
  return {
    seq: 1,
    type: "phase_started",
    phase: "propose",
    topicId: null,
    data: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("RunBroadcaster", () => {
  it("delivers a published event only to subscribers of that runId", () => {
    const broadcaster = new RunBroadcaster();
    const resA = fakeResponse();
    const resOther = fakeResponse();
    broadcaster.subscribe("run_a", resA);
    broadcaster.subscribe("run_other", resOther);

    broadcaster.publish("run_a", event());

    expect(resA.write).toHaveBeenCalled();
    expect(resOther.write).not.toHaveBeenCalled();
  });

  it("stops delivering to a response after it unsubscribes", () => {
    const broadcaster = new RunBroadcaster();
    const res = fakeResponse();
    const unsubscribe = broadcaster.subscribe("run_a", res);
    unsubscribe();

    broadcaster.publish("run_a", event());

    expect(res.write).not.toHaveBeenCalled();
  });

  it("ends the connection and forgets subscribers once a terminal event is published", () => {
    const broadcaster = new RunBroadcaster();
    const res = fakeResponse();
    broadcaster.subscribe("run_a", res);

    broadcaster.publish("run_a", event({ type: "run_completed", seq: 2 }));
    expect(res.end).toHaveBeenCalledTimes(1);
    const writesAfterTerminal = (res.write as ReturnType<typeof vi.fn>).mock
      .calls.length;

    // A stray late event after the run is over should no-op, not throw.
    broadcaster.publish("run_a", event({ type: "phase_started", seq: 3 }));
    expect(res.write).toHaveBeenCalledTimes(writesAfterTerminal);
  });
});

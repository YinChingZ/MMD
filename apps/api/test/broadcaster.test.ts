import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { PersistedRunEvent } from "../src/repositories/events-repo.js";
import { RunBroadcaster, type EphemeralRunEvent } from "../src/sse/broadcaster.js";

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

function ephemeralEvent(overrides: Partial<EphemeralRunEvent> = {}): EphemeralRunEvent {
  return {
    type: "token",
    phase: "compose",
    topicId: null,
    data: { delta: "hi" },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("RunBroadcaster — M6.4 publishEphemeral", () => {
  it("delivers an ephemeral event only to subscribers of that runId", () => {
    const broadcaster = new RunBroadcaster();
    const resA = fakeResponse();
    const resOther = fakeResponse();
    broadcaster.subscribe("run_a", resA);
    broadcaster.subscribe("run_other", resOther);

    broadcaster.publishEphemeral("run_a", ephemeralEvent());

    expect(resA.write).toHaveBeenCalled();
    expect(resOther.write).not.toHaveBeenCalled();
  });

  it("never writes an id: line (no DB-assigned seq — must never advance Last-Event-ID)", () => {
    const broadcaster = new RunBroadcaster();
    const res = fakeResponse();
    broadcaster.subscribe("run_a", res);

    broadcaster.publishEphemeral("run_a", ephemeralEvent());

    const writeCalls = (res.write as ReturnType<typeof vi.fn>).mock.calls;
    expect(writeCalls.some(([chunk]) => String(chunk).startsWith("id:"))).toBe(false);
  });

  it("still writes the correct event: line and JSON data payload", () => {
    const broadcaster = new RunBroadcaster();
    const res = fakeResponse();
    broadcaster.subscribe("run_a", res);

    broadcaster.publishEphemeral("run_a", ephemeralEvent({ data: { delta: "abc" } }));

    const writeCalls = (res.write as ReturnType<typeof vi.fn>).mock.calls.map(
      ([chunk]) => String(chunk)
    );
    expect(writeCalls).toContain("event: token\n");
    expect(writeCalls.some((c) => c.startsWith("data: ") && c.includes('"delta":"abc"'))).toBe(
      true
    );
  });

  it("never ends the connection (ephemeral events are never terminal)", () => {
    const broadcaster = new RunBroadcaster();
    const res = fakeResponse();
    broadcaster.subscribe("run_a", res);

    broadcaster.publishEphemeral("run_a", ephemeralEvent());

    expect(res.end).not.toHaveBeenCalled();
  });

  it("a stray ephemeral event after subscribers are gone no-ops, not throws", () => {
    const broadcaster = new RunBroadcaster();
    expect(() => broadcaster.publishEphemeral("nonexistent_run", ephemeralEvent())).not.toThrow();
  });
});

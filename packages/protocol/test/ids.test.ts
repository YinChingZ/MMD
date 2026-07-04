import { describe, expect, it } from "vitest";
import { makeRunId, parseScopedId, scopedId } from "../src/ids.js";

describe("run-scoped ids (risk #5: cross-run primary key collisions)", () => {
  it("round-trips runId/localId through scopedId/parseScopedId", () => {
    const runId = makeRunId();
    const id = scopedId(runId, "a_c1");
    expect(parseScopedId(id)).toEqual({ runId, localId: "a_c1" });
  });

  it("same local id from two different runs never collides", () => {
    const runA = makeRunId();
    const runB = makeRunId();
    expect(scopedId(runA, "a_c1")).not.toBe(scopedId(runB, "a_c1"));
  });

  it("makeRunId produces unique ids", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => makeRunId()));
    expect(ids.size).toBe(1000);
  });

  it("rejects runId containing the separator character", () => {
    expect(() => scopedId("run:bad", "a_c1")).toThrow();
  });

  it("throws on malformed scoped id without separator", () => {
    expect(() => parseScopedId("not-scoped")).toThrow();
  });
});

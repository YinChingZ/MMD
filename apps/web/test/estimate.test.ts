import { describe, expect, it } from "vitest";
import { estimateDuration } from "../src/lib/estimate";

describe("estimateDuration", () => {
  it("does not claim a benchmarked number for quick mode", () => {
    const text = estimateDuration("quick", 2);
    expect(text).toMatch(/not yet benchmarked/);
  });

  it("cites the real observed baseline range for standard mode", () => {
    const text = estimateDuration("standard", 3);
    expect(text).toMatch(/96–301s/);
  });

  it("notes planning mode's parallel-topics behavior", () => {
    const text = estimateDuration("planning", 3);
    expect(text).toMatch(/parallel/);
  });

  it("mentions the selected model count", () => {
    expect(estimateDuration("standard", 5)).toMatch(/5 models selected/);
    expect(estimateDuration("standard", 1)).toMatch(/1 model selected/);
  });
});

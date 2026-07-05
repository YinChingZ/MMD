import { describe, expect, it } from "vitest";
import { formatCostLimitLine, formatRunCost, formatSavedRate } from "../src/lib/cost";

describe("formatCostLimitLine", () => {
  it("states the configured limit, not a cost prediction", () => {
    const text = formatCostLimitLine(5);
    expect(text).toMatch(/\$5\.00/);
    expect(text).toMatch(/stops automatically/);
  });
});

describe("formatRunCost", () => {
  it("shows the accumulated total", () => {
    const text = formatRunCost({ totalUsd: 0.1234, hasUnknownPricing: false });
    expect(text).toMatch(/\$0\.1234/);
    expect(text).not.toMatch(/lower bound/);
  });

  it("flags when some models' cost couldn't be determined", () => {
    const text = formatRunCost({ totalUsd: 0.5, hasUnknownPricing: true });
    expect(text).toMatch(/lower bound/);
  });
});

describe("formatSavedRate", () => {
  it("formats both sides of the rate", () => {
    expect(formatSavedRate({ inputPerMillion: 2.5, outputPerMillion: 15 })).toBe(
      "$2.50/$15.00 per 1M tokens"
    );
  });
});

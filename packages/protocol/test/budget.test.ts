import { describe, expect, it } from "vitest";
import { getBudget, PLANNING_BUDGET, STANDARD_BUDGET, QUICK_MODE_BUDGET } from "../src/budget.js";

describe("getBudget", () => {
  it("returns STANDARD_BUDGET for 'standard'", () => {
    expect(getBudget("standard")).toBe(STANDARD_BUDGET);
  });

  it("returns QUICK_MODE_BUDGET for 'quick'", () => {
    expect(getBudget("quick")).toBe(QUICK_MODE_BUDGET);
  });

  it("returns PLANNING_BUDGET for 'planning'", () => {
    expect(getBudget("planning")).toBe(PLANNING_BUDGET);
  });
});

describe("PLANNING_BUDGET", () => {
  it("runs the full six-phase set per topic", () => {
    expect(PLANNING_BUDGET.phases).toEqual([
      "propose",
      "critique",
      "revise",
      "normalize",
      "vote",
      "compose",
    ]);
  });

  it("caps topic count at 8", () => {
    expect(PLANNING_BUDGET.maxTopics).toBe(8);
  });
});

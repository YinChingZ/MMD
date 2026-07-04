import { describe, expect, it } from "vitest";
import { checkQuorum, computeQuorum, meetsQuorum } from "../src/quorum.js";

describe("quorum (risk #4: single-model failure should not fail the whole run)", () => {
  it("3 models, default 2/3 ratio -> quorum of 2", () => {
    expect(computeQuorum(3)).toBe(2);
  });

  it("2 of 3 respondents meets quorum", () => {
    expect(meetsQuorum(2, 3)).toBe(true);
  });

  it("1 of 3 respondents does not meet quorum", () => {
    expect(meetsQuorum(1, 3)).toBe(false);
  });

  it("checkQuorum marks partial when respondents < modelCount", () => {
    const result = checkQuorum(2, 3);
    expect(result).toEqual({
      met: true,
      required: 2,
      respondentCount: 2,
      partial: true,
    });
  });

  it("checkQuorum is not partial when all models respond", () => {
    const result = checkQuorum(3, 3);
    expect(result.partial).toBe(false);
    expect(result.met).toBe(true);
  });
});

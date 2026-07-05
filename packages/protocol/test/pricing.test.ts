import { describe, expect, it } from "vitest";
import { calculateCostUsd, suggestedRateFor } from "../src/pricing.js";
import { DEEPSEEK_RATES, OPENAI_RATE, VOLCENGINE_RATE } from "../src/pricing-rates.js";

// Assertions below compute their expected values from pricing-rates.ts's
// exported constants rather than duplicating frozen numbers here — so this
// test keeps passing (and keeps testing the actual calculation, not a stale
// copy of it) when those rates are refreshed against their sources later.

describe("calculateCostUsd", () => {
  it("openrouter: reads usage.cost directly (exact)", () => {
    const result = calculateCostUsd("openrouter", {
      raw: { cost: 0.00234, prompt_tokens: 100, completion_tokens: 50 },
    });
    expect(result.precision).toBe("exact");
    expect(result.costUsd).toBe(0.00234);
  });

  it("openrouter: falls back to cost_details.upstream_inference_cost", () => {
    const result = calculateCostUsd("openrouter", {
      raw: { cost_details: { upstream_inference_cost: 0.0099 } },
    });
    expect(result.precision).toBe("exact");
    expect(result.costUsd).toBe(0.0099);
  });

  it("openrouter: unknown when no cost field present", () => {
    const result = calculateCostUsd("openrouter", {
      raw: { prompt_tokens: 100, completion_tokens: 50 },
    });
    expect(result.precision).toBe("unknown");
    expect(result.costUsd).toBeUndefined();
  });

  it("deepseek: splits cache hit/miss tokens, not a flat prompt-token rate", () => {
    const result = calculateCostUsd(
      "deepseek",
      {
        raw: {
          prompt_cache_hit_tokens: 1_000_000,
          prompt_cache_miss_tokens: 0,
          completion_tokens: 0,
        },
      },
      "deepseek-chat"
    );
    expect(result.precision).toBe("approximate");
    expect(result.costUsd).toBeCloseTo(DEEPSEEK_RATES.standard.cacheHitPerMillion, 5);

    const missResult = calculateCostUsd(
      "deepseek",
      {
        raw: {
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 1_000_000,
          completion_tokens: 0,
        },
      },
      "deepseek-chat"
    );
    expect(missResult.costUsd).toBeCloseTo(DEEPSEEK_RATES.standard.cacheMissPerMillion, 5);
    // cache hit must be cheaper than cache miss (the whole point of the
    // split), whatever the exact current rates are.
    expect(missResult.costUsd!).toBeGreaterThan(result.costUsd!);
  });

  it("deepseek: uses the pricier reasoner tier when modelId suggests it", () => {
    const standard = calculateCostUsd(
      "deepseek",
      { raw: { prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 1_000_000 } },
      "deepseek-chat"
    );
    const reasoner = calculateCostUsd(
      "deepseek",
      { raw: { prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 1_000_000 } },
      "deepseek-reasoner"
    );
    expect(reasoner.costUsd!).toBeGreaterThan(standard.costUsd!);
    expect(standard.costUsd).toBeCloseTo(DEEPSEEK_RATES.standard.cacheMissPerMillion, 5);
    expect(reasoner.costUsd).toBeCloseTo(DEEPSEEK_RATES.reasoner.cacheMissPerMillion, 5);
  });

  it("deepseek: unknown when cache hit/miss fields are absent", () => {
    const result = calculateCostUsd("deepseek", {
      raw: { prompt_tokens: 100 },
      promptTokens: 100,
    });
    expect(result.precision).toBe("unknown");
    expect(result.costUsd).toBeUndefined();
  });

  it("openai: approximate blended rate from normalized token counts", () => {
    const result = calculateCostUsd("openai", {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    });
    expect(result.precision).toBe("approximate");
    expect(result.costUsd).toBeCloseTo(
      OPENAI_RATE.inputPerMillion + OPENAI_RATE.outputPerMillion,
      5
    );
  });

  it("volcengine: approximate blended rate from normalized token counts", () => {
    const result = calculateCostUsd("volcengine", {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    });
    expect(result.precision).toBe("approximate");
    expect(result.costUsd).toBeCloseTo(
      VOLCENGINE_RATE.inputPerMillion + VOLCENGINE_RATE.outputPerMillion,
      5
    );
  });

  it("openai/volcengine: unknown when no token counts are present at all", () => {
    const result = calculateCostUsd("openai", {});
    expect(result.precision).toBe("unknown");
    expect(result.costUsd).toBeUndefined();
  });

  it("unrecognized or missing providerId: unknown, never a fabricated number", () => {
    expect(
      calculateCostUsd("some-self-hosted-thing", { promptTokens: 100 }).precision
    ).toBe("unknown");
    expect(
      calculateCostUsd(undefined, { promptTokens: 100 }).precision
    ).toBe("unknown");
  });

  describe("userRate override", () => {
    it("prices an unrecognized provider using a user-supplied rate instead of returning unknown", () => {
      const result = calculateCostUsd(
        "some-self-hosted-thing",
        { promptTokens: 1_000_000, completionTokens: 1_000_000 },
        undefined,
        { inputPerMillion: 1, outputPerMillion: 3 }
      );
      expect(result.precision).toBe("user-provided");
      expect(result.costUsd).toBeCloseTo(4, 5);
    });

    it("a user-supplied rate overrides the built-in approximate table for a known provider", () => {
      const result = calculateCostUsd(
        "openai",
        { promptTokens: 1_000_000, completionTokens: 1_000_000 },
        undefined,
        { inputPerMillion: 100, outputPerMillion: 200 }
      );
      expect(result.precision).toBe("user-provided");
      expect(result.costUsd).toBeCloseTo(300, 5);
      // sanity: this must not equal what the built-in OpenAI table would say
      expect(result.costUsd).not.toBeCloseTo(
        OPENAI_RATE.inputPerMillion + OPENAI_RATE.outputPerMillion,
        1
      );
    });

    it("OpenRouter's real reported cost still wins even when a userRate is also supplied", () => {
      const result = calculateCostUsd(
        "openrouter",
        { raw: { cost: 0.0042 } },
        undefined,
        { inputPerMillion: 999, outputPerMillion: 999 }
      );
      expect(result.precision).toBe("exact");
      expect(result.costUsd).toBe(0.0042);
    });

    it("falls back to the userRate when OpenRouter's response doesn't include a cost field", () => {
      const result = calculateCostUsd(
        "openrouter",
        { promptTokens: 1_000_000, completionTokens: 0, raw: {} },
        undefined,
        { inputPerMillion: 5, outputPerMillion: 0 }
      );
      expect(result.precision).toBe("user-provided");
      expect(result.costUsd).toBeCloseTo(5, 5);
    });

    it("without token usage, a userRate still can't produce a number", () => {
      const result = calculateCostUsd("some-self-hosted-thing", {}, undefined, {
        inputPerMillion: 1,
        outputPerMillion: 1,
      });
      expect(result.precision).toBe("unknown");
      expect(result.costUsd).toBeUndefined();
    });
  });
});

describe("suggestedRateFor", () => {
  it("suggests the built-in rate for openai/volcengine", () => {
    expect(suggestedRateFor("openai")).toEqual({
      inputPerMillion: OPENAI_RATE.inputPerMillion,
      outputPerMillion: OPENAI_RATE.outputPerMillion,
    });
    expect(suggestedRateFor("volcengine")).toEqual({
      inputPerMillion: VOLCENGINE_RATE.inputPerMillion,
      outputPerMillion: VOLCENGINE_RATE.outputPerMillion,
    });
  });

  it("suggests deepseek's pricier (cache-miss) rate, not the cache-hit one, to avoid undercounting by default", () => {
    const suggested = suggestedRateFor("deepseek");
    expect(suggested).toEqual({
      inputPerMillion: DEEPSEEK_RATES.standard.cacheMissPerMillion,
      outputPerMillion: DEEPSEEK_RATES.standard.outputPerMillion,
    });
  });

  it("has no suggestion for openrouter (real cost, nothing to guess) or an unrecognized provider", () => {
    expect(suggestedRateFor("openrouter")).toBeUndefined();
    expect(suggestedRateFor("some-self-hosted-thing")).toBeUndefined();
  });
});

// M5.1 cost circuit breaker: per-provider USD pricing strategies.
//
// Not a single unified $/token table — the four whitelisted providers
// (see provider-whitelist.ts) report and price usage differently enough
// that one table would be actively misleading:
// - OpenRouter's `usage` response already includes a real `cost` (or
//   `cost_details.upstream_inference_cost` for BYOK) — that's the actual
//   amount charged, more accurate than anything we could compute ourselves,
//   and always wins over everything else below when present.
// - A caller (in practice: a BYOK user who knows their own negotiated rate,
//   or is pricing a model/provider we don't otherwise recognize) can supply
//   a `userRate` directly. We can't re-fetch live pricing on every call, and
//   a built-in table always drifts eventually — the person actually paying
//   the bill is in the best position to keep this current, so a supplied
//   rate wins over our own built-in guess (though never over a provider's
//   own real reported cost).
// - DeepSeek splits prompt tokens into cache-hit/cache-miss buckets priced
//   far apart; collapsing them into one prompt-token rate would misprice
//   significantly depending on cache hit rate.
// - OpenAI/Volcengine use a single blended $/1M-token rate (not a
//   per-model-SKU table) since new SKUs ship faster than a hand-maintained
//   table could track — explicitly labeled "approximate", not exact.
// Unrecognized providers/models with no userRate return costUsd: undefined
// rather than a fabricated number — callers must not block or trip the
// circuit breaker on a value we don't actually have (see docs/protocol.md
// M5.1).
//
// The built-in rate numbers (and their sources/dates) live in
// pricing-rates.ts, deliberately separate from this calculation logic —
// refreshing a stale rate should be a one-line data edit there, not a
// change to the dispatch/math below.

import {
  DEEPSEEK_RATES,
  OPENAI_RATE,
  VOLCENGINE_RATE,
  type RateEntry,
} from "./pricing-rates.js";

export interface RawUsageInput {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /**
   * Raw provider-reported usage object, for provider-specific fields the
   * normalized ones above don't cover (DeepSeek's cache hit/miss split,
   * OpenRouter's cost/cost_details).
   */
  raw?: unknown;
}

/** A manually-supplied $/1M-token rate — from a BYOK user who knows their own current pricing, for a provider/model we either don't recognize or whose built-in rate they'd rather override. */
export interface UserProvidedRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

export type PricingPrecision = "exact" | "user-provided" | "approximate" | "unknown";

export interface PricingResult {
  /** Cost in USD for this single completion call, or undefined if it can't be priced. */
  costUsd?: number;
  precision: PricingPrecision;
  note: string;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function priceOpenRouter(usage: RawUsageInput): PricingResult {
  const raw = asRecord(usage.raw);
  const directCost = num(raw.cost);
  if (directCost !== undefined) {
    return {
      costUsd: directCost,
      precision: "exact",
      note: "OpenRouter reports the real per-request cost in usage.cost.",
    };
  }
  const upstreamCost = num(asRecord(raw.cost_details).upstream_inference_cost);
  if (upstreamCost !== undefined) {
    return {
      costUsd: upstreamCost,
      precision: "exact",
      note: "OpenRouter reports real upstream cost in usage.cost_details.upstream_inference_cost.",
    };
  }
  return {
    costUsd: undefined,
    precision: "unknown",
    note: "OpenRouter response did not include a cost field.",
  };
}

// Tier (standard vs reasoner) is guessed from the modelId string since BYOK
// modelId is free text and DeepSeek doesn't otherwise tell us which tier we
// called. Rate numbers live in pricing-rates.ts.
function priceDeepSeek(usage: RawUsageInput, modelId?: string): PricingResult {
  const raw = asRecord(usage.raw);
  const cacheHitTokens = num(raw.prompt_cache_hit_tokens);
  const cacheMissTokens = num(raw.prompt_cache_miss_tokens);
  const completionTokens = num(raw.completion_tokens) ?? usage.completionTokens;
  if (cacheHitTokens === undefined && cacheMissTokens === undefined) {
    return {
      costUsd: undefined,
      precision: "unknown",
      note: "DeepSeek response did not include prompt_cache_hit_tokens/prompt_cache_miss_tokens.",
    };
  }
  const tier =
    modelId && /pro|reasoner/i.test(modelId)
      ? DEEPSEEK_RATES.reasoner
      : DEEPSEEK_RATES.standard;
  const costUsd =
    ((cacheHitTokens ?? 0) * tier.cacheHitPerMillion +
      (cacheMissTokens ?? 0) * tier.cacheMissPerMillion +
      (completionTokens ?? 0) * tier.outputPerMillion) /
    1_000_000;
  return {
    costUsd,
    precision: "approximate",
    note: `Computed from DeepSeek's published cache-hit/cache-miss/output USD rates (as of ${tier.asOf}, ${tier.sourceUrl}; standard-vs-reasoner tier guessed from model id).`,
  };
}

function priceUserProvided(
  usage: RawUsageInput,
  rate: UserProvidedRate
): PricingResult {
  const promptTokens = usage.promptTokens;
  const completionTokens = usage.completionTokens;
  if (promptTokens === undefined && completionTokens === undefined) {
    return {
      costUsd: undefined,
      precision: "unknown",
      note: "No token usage available to apply the user-provided rate to.",
    };
  }
  const costUsd =
    ((promptTokens ?? 0) * rate.inputPerMillion +
      (completionTokens ?? 0) * rate.outputPerMillion) /
    1_000_000;
  return {
    costUsd,
    precision: "user-provided",
    note: "Computed from the $/1M-token rate you provided for this model.",
  };
}

function priceFlatTable(
  usage: RawUsageInput,
  rate: RateEntry,
  providerLabel: string
): PricingResult {
  const promptTokens = usage.promptTokens;
  const completionTokens = usage.completionTokens;
  if (promptTokens === undefined && completionTokens === undefined) {
    return {
      costUsd: undefined,
      precision: "unknown",
      note: `${providerLabel} response did not include token usage.`,
    };
  }
  const costUsd =
    ((promptTokens ?? 0) * rate.inputPerMillion +
      (completionTokens ?? 0) * rate.outputPerMillion) /
    1_000_000;
  const confidenceNote =
    rate.confidence === "low-confidence-secondary-sources"
      ? ` (${rate.note ?? "low confidence"})`
      : "";
  return {
    costUsd,
    precision: "approximate",
    note: `Computed from a blended $/1M-token rate for ${providerLabel} (as of ${rate.asOf}, ${rate.sourceUrl}) — not per-model-SKU accurate, may drift as new models ship${confidenceNote}.`,
  };
}

export interface SuggestedRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * A starting point for a BYOK user filling in a `userRate` override —
 * something to accept-or-adjust rather than typing one in from scratch.
 * OpenRouter has no suggestion (it reports real cost, there's nothing to
 * guess); an unrecognized providerId has none either. DeepSeek's suggestion
 * uses the pricier cache-miss/standard-tier rate as a rough single number,
 * since a flat two-value suggestion can't represent its real cache-hit/miss
 * split — better to suggest high than to undercount by default.
 */
export function suggestedRateFor(providerId: string): SuggestedRate | undefined {
  switch (providerId) {
    case "openai":
      return {
        inputPerMillion: OPENAI_RATE.inputPerMillion,
        outputPerMillion: OPENAI_RATE.outputPerMillion,
      };
    case "volcengine":
      return {
        inputPerMillion: VOLCENGINE_RATE.inputPerMillion,
        outputPerMillion: VOLCENGINE_RATE.outputPerMillion,
      };
    case "deepseek":
      return {
        inputPerMillion: DEEPSEEK_RATES.standard.cacheMissPerMillion,
        outputPerMillion: DEEPSEEK_RATES.standard.outputPerMillion,
      };
    default:
      return undefined;
  }
}

/**
 * Dispatches to a pricing strategy, in priority order:
 * 1. A provider's own real reported cost (currently only OpenRouter exposes
 *    this) — always wins, it's the actual bill, not an estimate.
 * 2. `userRate`, if supplied — works for *any* providerId, including one we
 *    don't otherwise recognize, since it's the caller's own current
 *    knowledge rather than a table we maintain.
 * 3. Our built-in approximate table, for the providers we have one for.
 * 4. `costUsd: undefined` ("unknown") — never a fabricated number.
 *
 * `providerId` is the provider-whitelist id ("openai" | "deepseek" |
 * "openrouter" | "volcengine"), not a display label — callers with no known
 * providerId (e.g. the legacy server-registry path, which can point at any
 * OpenAI-compatible endpoint) should pass undefined; a `userRate` can still
 * price that case via step 2 above.
 */
export function calculateCostUsd(
  providerId: string | undefined,
  usage: RawUsageInput,
  modelId?: string,
  userRate?: UserProvidedRate
): PricingResult {
  if (providerId === "openrouter") {
    const reported = priceOpenRouter(usage);
    if (reported.costUsd !== undefined) return reported;
  }

  if (userRate) {
    return priceUserProvided(usage, userRate);
  }

  switch (providerId) {
    case "openrouter":
      // Reached only when OpenRouter's response didn't include a cost field
      // and no userRate was given — re-derive the "unknown" result above.
      return priceOpenRouter(usage);
    case "deepseek":
      return priceDeepSeek(usage, modelId);
    case "openai":
      return priceFlatTable(usage, OPENAI_RATE, "OpenAI");
    case "volcengine":
      return priceFlatTable(usage, VOLCENGINE_RATE, "Volcengine");
    default:
      return {
        costUsd: undefined,
        precision: "unknown",
        note: providerId
          ? `No pricing strategy for provider "${providerId}" — supply a userRate to price it anyway.`
          : "No provider id known for this model — cost cannot be estimated. Supply a userRate to price it anyway.",
      };
  }
}

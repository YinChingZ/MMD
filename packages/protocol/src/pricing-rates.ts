// Sourced, dated rate data for the M5.1 cost circuit breaker's "approximate"
// providers (OpenAI, DeepSeek, Volcengine) — kept as a separate data module
// from pricing.ts's calculation logic specifically so refreshing a stale
// number later is a one-line data edit here, not a change to the logic that
// reads it. These rates WILL drift; check `asOf`/`sourceUrl` before trusting
// them for anything beyond a rough circuit-breaker estimate, and refresh
// this file directly against each source rather than an aggregator site —
// the previous version of this file was built from search-engine summaries
// of third-party pricing aggregators and was wrong on both DeepSeek (off by
// ~25x on cache-hit pricing) and OpenAI (priced a since-deprecated model);
// both were corrected 2026-07-04 by fetching the vendors' own docs directly.
//
// OpenRouter isn't here: it reports real cost directly in the response
// (`usage.cost` / `cost_details.upstream_inference_cost`), so it never needs
// a static rate — see pricing.ts's priceOpenRouter.

export interface RateEntry {
  /** USD per 1,000,000 input/prompt tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output/completion tokens. */
  outputPerMillion: number;
  sourceUrl: string;
  /** Date this rate was last checked against sourceUrl, YYYY-MM-DD. */
  asOf: string;
  /** Whether sourceUrl was fetched and read directly, or this is a best-effort figure from secondary sources that disagreed with each other. */
  confidence: "verified-primary-source" | "low-confidence-secondary-sources";
  note?: string;
}

export interface DeepSeekTierRate {
  cacheHitPerMillion: number;
  cacheMissPerMillion: number;
  outputPerMillion: number;
  sourceUrl: string;
  asOf: string;
}

// deepseek-chat / deepseek-reasoner, fetched directly from DeepSeek's own
// USD pricing docs (not an aggregator).
export const DEEPSEEK_RATES: Record<"standard" | "reasoner", DeepSeekTierRate> = {
  standard: {
    cacheHitPerMillion: 0.07,
    cacheMissPerMillion: 0.27,
    outputPerMillion: 1.1,
    sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing-details-usd/",
    asOf: "2026-07-04",
  },
  reasoner: {
    cacheHitPerMillion: 0.14,
    cacheMissPerMillion: 0.55,
    outputPerMillion: 2.19,
    sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing-details-usd/",
    asOf: "2026-07-04",
  },
};

export const OPENAI_RATE: RateEntry = {
  // gpt-5.4 — the current mainstream flagship tier (i.e. not mini/nano/pro)
  // on OpenAI's own pricing page as of asOf. GPT-4.1, used here previously,
  // no longer appears on that page at all.
  inputPerMillion: 2.5,
  outputPerMillion: 15,
  sourceUrl: "https://developers.openai.com/api/docs/pricing",
  asOf: "2026-07-04",
  confidence: "verified-primary-source",
};

export const VOLCENGINE_RATE: RateEntry = {
  // Volcengine's own pricing docs page is JS-rendered and couldn't be
  // scraped directly. This is a USD conversion (at an approximate 7.15
  // CNY/USD rate) of the ¥6/¥30 per-1M input/output figure that several
  // independent secondary sources agree on for the Doubao 2.1 Pro tier —
  // lowest-confidence of the three approximate providers.
  inputPerMillion: 0.84,
  outputPerMillion: 4.2,
  sourceUrl: "https://www.volcengine.com/docs/82379/1544681",
  asOf: "2026-07-04",
  confidence: "low-confidence-secondary-sources",
  note: "Could not fetch Volcengine's own docs page directly (JS-rendered); derived from secondary sources at an approximate FX rate — treat this one as the least reliable of the four providers.",
};

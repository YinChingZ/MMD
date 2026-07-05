import type { RunCostSummary } from "@mmd/orchestrator";

export interface SuggestedRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

export function formatSavedRate(rate: SuggestedRate): string {
  return `$${rate.inputPerMillion.toFixed(2)}/$${rate.outputPerMillion.toFixed(2)} per 1M tokens`;
}

// M5.1 cost circuit breaker. Mirrors estimate.ts's discipline of never
// fabricating a number we don't have — the pre-run line only states the
// configured limit (a real value the user is setting), not a prediction of
// what the run will actually cost, since per-token cost can't be known
// before any model has actually responded.
export function formatCostLimitLine(costLimitUsd: number): string {
  return `Cost limit: $${costLimitUsd.toFixed(2)} — the run stops automatically if this is exceeded.`;
}

export function formatRunCost(cost: RunCostSummary): string {
  const amount = `$${cost.totalUsd.toFixed(4)}`;
  if (cost.hasUnknownPricing) {
    return `Cost so far: ${amount} (lower bound — some models' cost couldn't be determined)`;
  }
  return `Cost so far: ${amount}`;
}

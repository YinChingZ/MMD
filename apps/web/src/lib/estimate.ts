import type { RunMode } from "@mmd/protocol";

// Ranges sourced from docs/protocol.md's "真实耗时基线" section (real runs
// against actual models), not packages/protocol/src/budget.ts's
// STANDARD_BUDGET/PLANNING_BUDGET constants — those are documented as stale
// mock-era guesses never recalibrated against real data. Deliberately not a
// formula scaled by model count: the observed data is a single range across
// the 2-3 model combinations tested so far, and a per-model formula would
// fabricate precision that isn't there.
export function estimateDuration(mode: RunMode, modelCount: number): string {
  const countNote = `with ${modelCount} model${modelCount === 1 ? "" : "s"} selected`;
  if (mode === "quick") {
    return `Usually well under a minute (fewer phases, fewer models) — not yet benchmarked against real models, ${countNote}.`;
  }
  if (mode === "planning") {
    return `Roughly 2–5 minutes (observed range 96–301s per topic in real runs; topics run in parallel, so total time tracks the slowest topic, not the sum), ${countNote}.`;
  }
  return `Roughly 2–5 minutes (observed range 96–301s across real runs so far), ${countNote}.`;
}

// M0 fix (risk #1): quick mode 和延迟预算必须是具体的协议路径，
// 不能只是"少跑几轮"这种模糊描述。

export const PHASES = [
  "propose",
  "critique",
  "revise",
  "normalize",
  "vote",
  "compose",
] as const;
export type Phase = (typeof PHASES)[number];

export type RunMode = "standard" | "quick" | "planning";

export interface RunBudget {
  modelCount: number;
  critiqueRounds: number;
  targetP50Ms: number;
  targetP95Ms: number;
  phases: Phase[];
  /** Extra per-call timeout used only by M6.6 web-search-enabled propose/critique. */
  toolRoundTripAllowanceMs?: number;
  /** planning mode only: hard cap on outline topic count (also enforced in OutlineResultSchema itself). */
  maxTopics?: number;
}

// 回填自 docs/protocol.md「真实耗时基线」一节：同厂商组合单次 run 耗时
// 96-250s，跨厂商组合（OpenRouter 统一接入）164-301s，样本量小、不是严格
// 意义上的百分位统计，取整个观测区间的中段/上界作为 p50/p95。
// 注意 targetP95Ms 同时是 fanOutWithQuorum 单次模型调用的默认超时
// （见 packages/orchestrator/src/index.ts 的 timeoutMs），比整个 run 的
// p95 宽松是刻意的——单个 phase 里一次模型调用的耗时远小于全部六阶段的
// 总耗时，用整 run 的 p95 当单次调用超时只会让真正卡死的调用更晚被发现，
// 但目前没有单独的分阶段耗时数据来校准更紧的超时值，先用这个偏宽松但不
// 会误杀真实调用的值。
export const STANDARD_BUDGET: RunBudget = {
  modelCount: 3,
  critiqueRounds: 1,
  targetP50Ms: 150_000,
  targetP95Ms: 300_000,
  phases: [...PHASES],
  toolRoundTripAllowanceMs: 15_000,
};

// quick mode 还没有用真实模型基准测过（见 docs/protocol.md），维持 M0
// 时期的猜测值，不跟着 standard/planning 一起回填。
// quick mode: 2 模型，跳过 critique/revise/vote。normalize 阶段保留，
// 因为没有显式投票时，仍需要用 candidate 的 source_claim_ids 覆盖了几个
// 模型来推断共识强度（每个来源模型视为一票隐含 approve），否则 compose
// 阶段完全没有共识信号可用。
export const QUICK_MODE_BUDGET: RunBudget = {
  modelCount: 2,
  critiqueRounds: 0,
  targetP50Ms: 20_000,
  targetP95Ms: 40_000,
  phases: ["propose", "normalize", "compose"],
  toolRoundTripAllowanceMs: 15_000,
};

// planning mode: the full six-phase set (propose/critique/revise/normalize/
// vote/compose) still runs, just once per outline topic instead of once for
// the whole run — so the same per-topic targets as standard mode apply, plus
// a cap on how many topics an outline can produce.
export const PLANNING_BUDGET: RunBudget = {
  modelCount: 3,
  critiqueRounds: 1,
  targetP50Ms: 150_000,
  targetP95Ms: 300_000,
  phases: [...PHASES],
  toolRoundTripAllowanceMs: 15_000,
  maxTopics: 8,
};

export function getBudget(mode: RunMode): RunBudget {
  if (mode === "quick") return QUICK_MODE_BUDGET;
  if (mode === "planning") return PLANNING_BUDGET;
  return STANDARD_BUDGET;
}

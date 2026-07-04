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
  /** planning mode only: hard cap on outline topic count (also enforced in OutlineResultSchema itself). */
  maxTopics?: number;
}

// 目标基线数字待 M1 用真实数据校准，这里先给出协议约定的起始值。
export const STANDARD_BUDGET: RunBudget = {
  modelCount: 3,
  critiqueRounds: 1,
  targetP50Ms: 60_000,
  targetP95Ms: 120_000,
  phases: [...PHASES],
};

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
};

// planning mode: the full six-phase set (propose/critique/revise/normalize/
// vote/compose) still runs, just once per outline topic instead of once for
// the whole run — so the same per-topic targets as standard mode apply, plus
// a cap on how many topics an outline can produce.
export const PLANNING_BUDGET: RunBudget = {
  modelCount: 3,
  critiqueRounds: 1,
  targetP50Ms: 60_000,
  targetP95Ms: 120_000,
  phases: [...PHASES],
  maxTopics: 8,
};

export function getBudget(mode: RunMode): RunBudget {
  if (mode === "quick") return QUICK_MODE_BUDGET;
  if (mode === "planning") return PLANNING_BUDGET;
  return STANDARD_BUDGET;
}

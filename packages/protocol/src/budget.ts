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

export type RunMode = "standard" | "quick";

export interface RunBudget {
  modelCount: number;
  critiqueRounds: number;
  targetP50Ms: number;
  targetP95Ms: number;
  phases: Phase[];
}

// 目标基线数字待 M1 用真实数据校准，这里先给出协议约定的起始值。
export const STANDARD_BUDGET: RunBudget = {
  modelCount: 3,
  critiqueRounds: 1,
  targetP50Ms: 60_000,
  targetP95Ms: 120_000,
  phases: [...PHASES],
};

// quick mode: 2 模型，跳过 critique/revise/vote，只做 propose 后直接 compose。
export const QUICK_MODE_BUDGET: RunBudget = {
  modelCount: 2,
  critiqueRounds: 0,
  targetP50Ms: 20_000,
  targetP95Ms: 40_000,
  phases: ["propose", "compose"],
};

export function getBudget(mode: RunMode): RunBudget {
  return mode === "quick" ? QUICK_MODE_BUDGET : STANDARD_BUDGET;
}

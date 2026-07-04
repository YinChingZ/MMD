import type { ConsensusLabel } from "./schemas/common.js";
import type { Ballot } from "./schemas/vote.js";

// M0 fix (risk #3): 原设计用 "3/3 approve" 这类硬编码计数判定共识，
// 模型数一变就要重写。这里改成比例阈值，支持任意数量的模型。

export interface ConsensusThresholds {
  /** approve_ratio 达到此值才算 strong_consensus（默认要求全体 approve）。 */
  strongApproveRatio: number;
  /** approve_ratio 达到此值且无 critical 反对，算 qualified_consensus。 */
  qualifiedApproveRatio: number;
  /** approve_ratio 低于或等于此值，直接 rejected。 */
  rejectApproveRatio: number;
}

export const DEFAULT_CONSENSUS_THRESHOLDS: ConsensusThresholds = {
  strongApproveRatio: 1.0,
  qualifiedApproveRatio: 0.66,
  rejectApproveRatio: 0.34,
};

export interface ClassifyCandidateInput {
  ballotsForCandidate: Ballot[];
  /** 配置的模型数量（法定投票人数），不是实际投票数——用于计算比例和识别 partial。 */
  expectedVoterCount: number;
  thresholds?: ConsensusThresholds;
}

export interface ClassifyCandidateResult {
  label: ConsensusLabel;
  approveRatio: number;
  hasCriticalObjection: boolean;
  hasMajorObjection: boolean;
  /** 实际投票数少于 expectedVoterCount，说明有模型未响应（quorum 相关）。 */
  partial: boolean;
}

export function classifyCandidate(
  input: ClassifyCandidateInput
): ClassifyCandidateResult {
  const { ballotsForCandidate, expectedVoterCount } = input;
  const thresholds = input.thresholds ?? DEFAULT_CONSENSUS_THRESHOLDS;

  if (expectedVoterCount <= 0) {
    throw new Error("expectedVoterCount must be > 0");
  }

  const approveCount = ballotsForCandidate.filter(
    (b) => b.vote === "approve" || b.vote === "approve_with_conditions"
  ).length;
  const approveRatio = approveCount / expectedVoterCount;

  const objections = ballotsForCandidate.filter((b) => b.vote === "object");
  const hasCriticalObjection = objections.some(
    (b) => b.objection_severity === "critical"
  );
  const hasMajorObjection = objections.some(
    (b) => b.objection_severity === "major"
  );
  const partial = ballotsForCandidate.length < expectedVoterCount;

  let label: ConsensusLabel;
  if (hasCriticalObjection) {
    // critical objection 直接进入 disputed，不能被多数票吞掉。
    label = "disputed";
  } else if (hasMajorObjection) {
    label =
      approveRatio >= thresholds.qualifiedApproveRatio ? "disputed" : "rejected";
  } else if (approveRatio >= thresholds.strongApproveRatio) {
    label = "strong_consensus";
  } else if (approveRatio >= thresholds.qualifiedApproveRatio) {
    label = "qualified_consensus";
  } else if (approveRatio <= thresholds.rejectApproveRatio) {
    label = "rejected";
  } else {
    label = "disputed";
  }

  return { label, approveRatio, hasCriticalObjection, hasMajorObjection, partial };
}

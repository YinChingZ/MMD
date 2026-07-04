// M0 fix (risk #4): 每个阶段需要一个最低响应法定人数（quorum），
// 未达到时该阶段应标记为 partial，而不是让整个 run 失败。

export function computeQuorum(modelCount: number, ratio = 2 / 3): number {
  if (modelCount <= 0) {
    throw new Error("modelCount must be > 0");
  }
  return Math.max(1, Math.ceil(modelCount * ratio));
}

export function meetsQuorum(
  respondentCount: number,
  modelCount: number,
  ratio = 2 / 3
): boolean {
  return respondentCount >= computeQuorum(modelCount, ratio);
}

export interface QuorumCheck {
  met: boolean;
  required: number;
  respondentCount: number;
  partial: boolean;
}

export function checkQuorum(
  respondentCount: number,
  modelCount: number,
  ratio = 2 / 3
): QuorumCheck {
  const required = computeQuorum(modelCount, ratio);
  return {
    met: respondentCount >= required,
    required,
    respondentCount,
    partial: respondentCount < modelCount,
  };
}

import { randomUUID } from "node:crypto";

// M0 fix (risk #5): claim/candidate id 必须按 run 隔离，避免跨 run 主键冲突。
// 格式固定为 `${runId}:${localId}`，写库时可直接作为复合键的两列，
// 或者整体作为字符串主键使用。

export function makeRunId(): string {
  return `run_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function scopedId(runId: string, localId: string): string {
  if (!runId || !localId) {
    throw new Error("runId and localId must be non-empty");
  }
  if (runId.includes(":")) {
    throw new Error(`runId must not contain ':': ${runId}`);
  }
  return `${runId}:${localId}`;
}

export interface ParsedScopedId {
  runId: string;
  localId: string;
}

export function parseScopedId(id: string): ParsedScopedId {
  const idx = id.indexOf(":");
  if (idx === -1) {
    throw new Error(`invalid scoped id (expected "runId:localId"): ${id}`);
  }
  return { runId: id.slice(0, idx), localId: id.slice(idx + 1) };
}

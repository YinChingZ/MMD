import type { Governance, RunMode } from "@mmd/protocol";
import { governanceForMode } from "./governance";
import type { ByokEntryUI } from "./model-sources";

/**
 * 失败重试用的配置快照：只填回输入框与配置，不自动发送（用户确认后选择）。
 * BYOK 条目只保留 savedKeyId 支撑的（可安全还原），原始 apiKey 明文永不
 * 落 sessionStorage —— 被丢弃的条目 label 记在 droppedByokLabels 里，
 * 供还原时提示用户重新添加。
 */
export interface RetrySnapshot {
  question: string;
  mode: RunMode;
  governance: Governance;
  modelIds: string[];
  costLimitUsd: number;
  outputSchemaText: string;
  webSearch: boolean;
  byokEntries: ByokEntryUI[];
  droppedByokLabels: string[];
}

const KEY_PREFIX = "mmd.retry.";

export function retryStorageKey(runId: string): string {
  return `${KEY_PREFIX}${runId}`;
}

export function buildRetrySnapshot(params: {
  question: string;
  mode: RunMode;
  governance: Governance;
  modelIds: string[];
  costLimitUsd: number;
  outputSchemaText: string;
  webSearch: boolean;
  byokEntries: ByokEntryUI[];
}): RetrySnapshot {
  const savedOnly = params.byokEntries.filter((e) => "savedKeyId" in e.payload);
  const droppedByokLabels = params.byokEntries
    .filter((e) => !("savedKeyId" in e.payload))
    .map((e) => e.label);
  return {
    question: params.question,
    mode: params.mode,
    governance: governanceForMode(params.mode, params.governance),
    modelIds: params.modelIds,
    costLimitUsd: params.costLimitUsd,
    outputSchemaText: params.outputSchemaText,
    webSearch: params.webSearch,
    byokEntries: savedOnly,
    droppedByokLabels,
  };
}

export function saveRetrySnapshot(runId: string, snapshot: RetrySnapshot): void {
  sessionStorage.setItem(retryStorageKey(runId), JSON.stringify(snapshot));
}

/** 一次性读取：命中后立即从 sessionStorage 移除。 */
export function consumeRetrySnapshot(runId: string): RetrySnapshot | undefined {
  const key = retryStorageKey(runId);
  const raw = sessionStorage.getItem(key);
  if (!raw) return undefined;
  sessionStorage.removeItem(key);
  try {
    return JSON.parse(raw) as RetrySnapshot;
  } catch {
    return undefined;
  }
}

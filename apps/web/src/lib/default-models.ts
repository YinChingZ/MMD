/**
 * 用户标记的"默认模型"：新会话初始化选择时优先套用（覆盖 useRunConfig 的
 * 通用默认规则）。纯客户端 localStorage 偏好——这个应用的 workspace 本质
 * 上就是设备 cookie，与已存 BYOK 密钥的"仅本设备"语义一致，不需要后端。
 */

export type DefaultModelMark =
  | { kind: "legacy"; id: string }
  | {
      kind: "byokSavedKey";
      savedKeyId: string;
      label: string;
      providerLabel: string;
    };

const STORAGE_KEY = "mmd.defaultModels";

export function getDefaultModels(): DefaultModelMark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DefaultModelMark[]) : [];
  } catch {
    return [];
  }
}

function setDefaultModels(marks: DefaultModelMark[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
}

export function isLegacyDefault(marks: DefaultModelMark[], id: string): boolean {
  return marks.some((m) => m.kind === "legacy" && m.id === id);
}

export function isSavedKeyDefault(
  marks: DefaultModelMark[],
  savedKeyId: string,
): boolean {
  return marks.some((m) => m.kind === "byokSavedKey" && m.savedKeyId === savedKeyId);
}

/** 切换内置模型的默认标记，返回更新后的列表（已持久化）。 */
export function toggleLegacyDefault(
  marks: DefaultModelMark[],
  id: string,
): DefaultModelMark[] {
  const next = isLegacyDefault(marks, id)
    ? marks.filter((m) => !(m.kind === "legacy" && m.id === id))
    : [...marks, { kind: "legacy" as const, id }];
  setDefaultModels(next);
  return next;
}

/** 切换已存密钥的默认标记，返回更新后的列表（已持久化）。 */
export function toggleSavedKeyDefault(
  marks: DefaultModelMark[],
  entry: { savedKeyId: string; label: string; providerLabel: string },
): DefaultModelMark[] {
  const next = isSavedKeyDefault(marks, entry.savedKeyId)
    ? marks.filter((m) => !(m.kind === "byokSavedKey" && m.savedKeyId === entry.savedKeyId))
    : [...marks, { kind: "byokSavedKey" as const, ...entry }];
  setDefaultModels(next);
  return next;
}

/** 密钥被删除时一并清理其默认标记（若存在）。 */
export function removeDefaultModel(savedKeyId: string): void {
  const next = getDefaultModels().filter(
    (m) => !(m.kind === "byokSavedKey" && m.savedKeyId === savedKeyId),
  );
  setDefaultModels(next);
}

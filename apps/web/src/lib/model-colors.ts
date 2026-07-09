/**
 * 模型 id → 确定性头像配色与缩写。
 * 纯函数：同一 modelId 永远得到同一色相，保证跨页面/跨会话一致。
 */

const HUES = [22, 50, 95, 150, 200, 235, 265, 300, 335] as const;

function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

export interface ModelColor {
  /** 头像底色（oklch 淡底） */
  bg: string;
  /** 头像前景 / 边框强调色 */
  fg: string;
}

export function modelColor(modelId: string): ModelColor {
  const hue = HUES[hashString(modelId) % HUES.length];
  return {
    bg: `oklch(0.93 0.045 ${hue})`,
    fg: `oklch(0.5 0.13 ${hue})`,
  };
}

/** 提取用于头像的 1–2 位缩写：取厂商/模型名的首字母或数字段。 */
export function modelInitials(modelId: string): string {
  const base = modelId.split("/").pop() ?? modelId;
  const parts = base.split(/[-_.\s]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const a = parts[0][0] ?? "";
  // 第二段优先取字母，跳过纯版本数字（gpt-4o → GP 不如 G4？取首字母+次段首字符即可）
  const b = parts[1][0] ?? "";
  return (a + b).toUpperCase();
}

/** 展示名：去掉厂商前缀，保留模型本名。 */
export function modelDisplayName(modelId: string): string {
  return modelId.split("/").pop() ?? modelId;
}

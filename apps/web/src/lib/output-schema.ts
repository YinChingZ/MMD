import type { OutputFormatInput } from "./api";

export type ParsedOutputSchema =
  | { ok: true; outputFormat: OutputFormatInput | undefined }
  | { ok: false; error: string };

/**
 * 把高级配置里的 JSON Schema 文本解析为 createRun 的 outputFormat。
 * 空文本 = 不启用（返回 undefined），非对象/解析失败返回错误信息。
 * 从原 QuestionForm.submit 中抽出的纯函数，便于测试。
 */
export function parseOutputSchema(text: string): ParsedOutputSchema {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, outputFormat: undefined };
  try {
    const schema = JSON.parse(trimmed);
    if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
      throw new Error("must be a JSON object");
    }
    return { ok: true, outputFormat: { type: "json_schema", schema } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

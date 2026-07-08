import type { z } from "zod";

export interface StructuredCallOptions {
  maxRepairAttempts?: number;
}

export function extractJson(text: string): string {
  const fenced =
    text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * Calls `complete` (a closure that already knows which model/prompt to use),
 * parses the response as JSON, and validates it against `schema`. On parse or
 * validation failure it re-invokes `complete` with a repair note describing
 * what went wrong, up to `maxRepairAttempts` times, instead of failing the
 * whole phase on the first malformed response.
 */
export async function callStructured<T>(
  complete: (repairNote?: string) => Promise<{ text: string }>,
  // Input is widened to `any` (rather than defaulting to T) because schemas
  // with `.default(...)` have an Output type that differs from their Input
  // type; pinning both to T here made TS unify T with the wrong one.
  schema: z.ZodType<T, z.ZodTypeDef, any>,
  opts: StructuredCallOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxRepairAttempts ?? 2;
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    const repairNote = lastError
      ? `Your previous output failed JSON schema validation: ${lastError}. Return corrected JSON only, no prose.`
      : undefined;
    const { text } = await complete(repairNote);

    try {
      const parsed = JSON.parse(extractJson(text));
      const result = schema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      lastError = result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(
    `structured output failed schema validation after ${maxAttempts + 1} attempts: ${lastError}`
  );
}

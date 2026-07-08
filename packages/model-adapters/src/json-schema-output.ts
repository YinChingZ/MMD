import Ajv from "ajv";
import { extractJson } from "./structured.js";

export interface CallJsonSchemaOptions {
  maxRepairAttempts?: number;
}

/**
 * Same repair-retry loop as `callStructured`, but validates against a
 * caller-supplied *runtime* JSON Schema (Ajv) instead of a zod schema —
 * for M6.1 user-defined output, where the shape isn't known until request time.
 */
export async function callJsonSchema(
  complete: (repairNote?: string) => Promise<{ text: string }>,
  jsonSchema: Record<string, unknown>,
  opts: CallJsonSchemaOptions = {}
): Promise<unknown> {
  const maxAttempts = opts.maxRepairAttempts ?? 2;
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(jsonSchema);
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    const repairNote = lastError
      ? `Your previous output failed JSON schema validation: ${lastError}. Return corrected JSON only, no prose.`
      : undefined;
    const { text } = await complete(repairNote);

    try {
      const parsed = JSON.parse(extractJson(text));
      if (validate(parsed)) {
        return parsed;
      }
      lastError = (validate.errors ?? [])
        .map((e) => `${e.instancePath || "(root)"}: ${e.message}`)
        .join("; ");
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(
    `user-defined JSON output failed schema validation after ${maxAttempts + 1} attempts: ${lastError}`
  );
}

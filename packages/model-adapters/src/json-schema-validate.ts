// M6.1 v1 only supports a conservative JSON Schema subset — no `$ref`/recursion —
// per docs/streaming-tools-multimodal-json.md section 1's implementation path.
const ALLOWED_KEYWORDS = new Set([
  "type",
  "enum",
  "required",
  "properties",
  "items",
  "additionalProperties",
]);

const ALLOWED_TYPES = new Set([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

const MAX_DEPTH = 6;
const MAX_SIZE_BYTES = 16 * 1024;

export type ValidateOutputFormatSchemaResult =
  | { ok: true }
  | { ok: false; error: string };

function walk(node: unknown, depth: number, path: string): string | undefined {
  if (depth > MAX_DEPTH) {
    return `schema exceeds max depth of ${MAX_DEPTH} at ${path}`;
  }
  if (Array.isArray(node) || node === null || typeof node !== "object") {
    // enum/required arrays and scalar keyword values are fine as-is.
    return undefined;
  }

  const obj = node as Record<string, unknown>;
  if ("$ref" in obj) {
    return `$ref is not supported (v1 does not allow $ref/recursive schemas) at ${path}`;
  }

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYWORDS.has(key)) {
      return `unsupported schema keyword "${key}" at ${path}`;
    }
  }

  if ("type" in obj) {
    const type = obj.type;
    const types = Array.isArray(type) ? type : [type];
    for (const t of types) {
      if (typeof t !== "string" || !ALLOWED_TYPES.has(t)) {
        return `unsupported type "${String(t)}" at ${path}`;
      }
    }
  }

  if ("properties" in obj) {
    const properties = obj.properties;
    if (typeof properties !== "object" || properties === null) {
      return `"properties" must be an object at ${path}`;
    }
    for (const [key, value] of Object.entries(
      properties as Record<string, unknown>
    )) {
      const err = walk(value, depth + 1, `${path}.properties.${key}`);
      if (err) return err;
    }
  }

  if ("items" in obj) {
    const err = walk(obj.items, depth + 1, `${path}.items`);
    if (err) return err;
  }

  if (
    "additionalProperties" in obj &&
    typeof obj.additionalProperties === "object" &&
    obj.additionalProperties !== null
  ) {
    const err = walk(
      obj.additionalProperties,
      depth + 1,
      `${path}.additionalProperties`
    );
    if (err) return err;
  }

  return undefined;
}

/**
 * Validates a caller-supplied JSON Schema (for M6.1 outputFormat) against the
 * v1 subset before a run is ever created, so a bad schema fails fast with a
 * 400 instead of surfacing mid-run — see
 * docs/streaming-tools-multimodal-json.md section 1.
 */
export function validateOutputFormatSchema(
  schema: unknown
): ValidateOutputFormatSchemaResult {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return { ok: false, error: "outputFormat.schema must be a JSON object" };
  }

  const size = Buffer.byteLength(JSON.stringify(schema), "utf8");
  if (size > MAX_SIZE_BYTES) {
    return {
      ok: false,
      error: `outputFormat.schema is too large (${size} bytes > ${MAX_SIZE_BYTES} byte limit)`,
    };
  }

  const err = walk(schema, 0, "$");
  if (err) return { ok: false, error: err };
  return { ok: true };
}

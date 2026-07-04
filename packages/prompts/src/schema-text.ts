import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

/**
 * Renders a zod schema as JSON Schema text for embedding in a prompt.
 * Deriving this from the same schema that validates the response (rather than
 * hand-writing a parallel description) is what keeps the prompt from silently
 * drifting out of sync with packages/protocol.
 */
export function describeSchema(schema: z.ZodTypeAny, name: string): string {
  const jsonSchema = zodToJsonSchema(schema, name);
  return JSON.stringify(jsonSchema, null, 2);
}

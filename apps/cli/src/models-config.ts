import { readFileSync } from "node:fs";
import { z } from "zod";

export const ModelEntrySchema = z.object({
  /** Label used throughout the deliberation pipeline (claim ids, logs, output). Keep it short, e.g. "model_a". */
  id: z.string().min(1),
  /** The real model id/name this provider's API expects, e.g. "gpt-4.1" or "openai/gpt-4.1". */
  modelId: z.string().min(1),
  /** Base URL of an OpenAI-compatible /chat/completions endpoint. */
  baseUrl: z.string().min(1),
  /** Name of the environment variable holding this model's API key. Set the actual value in .env, not here. */
  apiKeyEnvVar: z.string().min(1),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ModelsConfigSchema = z.object({
  /** Model id used for the normalize/compose "editor" calls. Defaults to the first entry. */
  coordinatorModelId: z.string().optional(),
  models: z.array(ModelEntrySchema).min(1),
});
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

export function loadModelsConfig(path: string): ModelsConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = ModelsConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`invalid models config at ${path}: ${issues}`);
  }
  for (const m of parsed.data.models) {
    if (m.modelId.includes("REPLACE_WITH") || m.baseUrl.includes("REPLACE_WITH")) {
      throw new Error(
        `${path} still has placeholder values for model "${m.id}" — fill in modelId/baseUrl before running for real.`
      );
    }
  }
  return parsed.data;
}

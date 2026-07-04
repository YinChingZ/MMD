import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Same shape as apps/cli's models.config.json — kept as a separate, small
 * definition rather than a shared package: the two loaders read from
 * different default paths (CLI's CWD-relative file vs the API's fixed
 * server-side config) and the duplication is ~25 lines, not worth an
 * abstraction.
 */
export const ModelEntrySchema = z.object({
  id: z.string().min(1),
  modelId: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKeyEnvVar: z.string().min(1),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ModelsConfigSchema = z.object({
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

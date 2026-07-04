import {
  MockProvider,
  OpenAICompatibleProvider,
  RoutingProvider,
  type ModelProvider,
} from "@mmd/model-adapters";
import type { ModelsConfig } from "./models-config.js";

export interface ResolvedProvider {
  provider: ModelProvider;
  /** Model ids a run-creation request may pick from via `modelIds`. */
  availableModelIds: string[];
  coordinatorModelId?: string;
  /** true when falling back to MockProvider (no models.config.json found) — mirrors apps/cli's behavior, no real network calls are made. */
  isMock: boolean;
  modelIdToProviderLabel: (id: string) => string;
}

/**
 * Server-side model registry, resolved once at startup — run-creation
 * requests only ever pick `modelIds` from `availableModelIds`, never supply
 * their own baseUrl/provider (see the M2 plan's "model selection is
 * server-side" deviation from the original tech design's API draft: avoids
 * SSRF via an arbitrary client-supplied baseUrl and avoids needing
 * client-supplied API keys).
 */
export function buildProvider(
  modelsConfig: ModelsConfig | undefined
): ResolvedProvider {
  if (!modelsConfig) {
    return {
      provider: new MockProvider(),
      availableModelIds: ["model_a", "model_b", "model_c"],
      isMock: true,
      modelIdToProviderLabel: () => "mock",
    };
  }

  const routes = new Map(
    modelsConfig.models.map((m) => [
      m.id,
      {
        provider: new OpenAICompatibleProvider({
          baseUrl: m.baseUrl,
          apiKeyEnvVar: m.apiKeyEnvVar,
        }),
        apiModelId: m.modelId,
      },
    ])
  );

  return {
    provider: new RoutingProvider(routes),
    availableModelIds: modelsConfig.models.map((m) => m.id),
    coordinatorModelId:
      modelsConfig.coordinatorModelId ?? modelsConfig.models[0]?.id,
    isMock: false,
    modelIdToProviderLabel: () => "openai-compatible",
  };
}

import {
  MockProvider,
  OpenAICompatibleProvider,
  RoutingProvider,
  type ModelConfig,
  type ModelProvider,
  type RoutingProviderRoute,
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

/** A single client-supplied (BYOK) model for one run: a whitelisted provider's fixed baseUrl, the caller's own API key, and the real model id to call. */
export interface RunProviderByokEntry {
  /** Label used throughout the deliberation pipeline for this model (claim ids, etc) — must not collide with a selected legacy model id or another byok entry. */
  label: string;
  /** Fixed baseUrl of the whitelisted provider — never client-supplied directly. */
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** Human-readable provider label surfaced via modelIdToProviderLabel (e.g. the whitelist's displayName). */
  providerLabel: string;
}

export interface RunProviderResult {
  provider: ModelProvider;
  models: ModelConfig[];
  coordinatorModelId?: string;
  modelIdToProviderLabel: (id: string) => string;
}

/**
 * Builds the provider for a single run by merging a subset of the startup-time
 * legacy registry with any client-supplied BYOK entries into one RoutingProvider.
 * Called per-request (unlike buildProvider, which runs once at startup) since
 * BYOK credentials only exist for the lifetime of the request that supplied them.
 */
export function buildRunProvider(params: {
  legacy: ResolvedProvider;
  selectedLegacyIds: string[];
  byokModels: RunProviderByokEntry[];
}): RunProviderResult {
  const { legacy, selectedLegacyIds, byokModels } = params;

  const byokLabels = byokModels.map((m) => m.label);
  if (new Set(byokLabels).size !== byokLabels.length) {
    throw new Error("byokModels contains duplicate labels");
  }
  const collidingLabels = selectedLegacyIds.filter((id) =>
    byokLabels.includes(id)
  );
  if (collidingLabels.length) {
    throw new Error(
      `model label(s) used by both the server registry and byokModels: ${collidingLabels.join(", ")}`
    );
  }

  const routes = new Map<string, RoutingProviderRoute>();
  for (const id of selectedLegacyIds) {
    // Delegate to the legacy provider keyed by the same label — it already
    // knows how to resolve that label to the right vendor/apiModelId.
    routes.set(id, { provider: legacy.provider, apiModelId: id });
  }
  for (const entry of byokModels) {
    routes.set(entry.label, {
      provider: new OpenAICompatibleProvider({
        baseUrl: entry.baseUrl,
        apiKey: entry.apiKey,
      }),
      apiModelId: entry.modelId,
    });
  }

  const byokProviderLabels = new Map(
    byokModels.map((m) => [m.label, m.providerLabel])
  );
  const modelIdToProviderLabel = (id: string) =>
    byokProviderLabels.get(id) ?? legacy.modelIdToProviderLabel(id);

  const allIds = [...selectedLegacyIds, ...byokLabels];
  return {
    provider: new RoutingProvider(routes),
    models: allIds.map((id) => ({ id, provider: modelIdToProviderLabel(id) })),
    coordinatorModelId: legacy.coordinatorModelId,
    modelIdToProviderLabel,
  };
}

import type {
  CompletionRequest,
  CompletionResult,
  ModelConfig,
  ModelProvider,
} from "../provider.js";

export interface RoutingProviderRoute {
  /** The underlying provider that actually makes the call (e.g. an OpenAICompatibleProvider pointed at a specific vendor/proxy). */
  provider: ModelProvider;
  /** The real model id to send to that provider's API — may differ from the label used elsewhere in the pipeline (claim ids, logs, etc). */
  apiModelId: string;
}

/**
 * Lets each configured model (identified by ModelConfig.id, the label used
 * throughout the deliberation pipeline for claim ids etc.) be backed by a
 * different provider instance — different base URL, API key, and even a
 * different real model id. This is what makes "3 different models" actually
 * mean 3 different vendors/endpoints instead of 3 calls to the same one.
 */
export class RoutingProvider implements ModelProvider {
  readonly name = "routing";

  constructor(private readonly routes: Map<string, RoutingProviderRoute>) {}

  async complete(
    config: ModelConfig,
    request: CompletionRequest
  ): Promise<CompletionResult> {
    const route = this.routes.get(config.id);
    if (!route) {
      throw new Error(`no provider route configured for model "${config.id}"`);
    }
    return route.provider.complete(
      { id: route.apiModelId, provider: config.provider },
      request
    );
  }

  /**
   * M6.3/M6.4: always attached (unlike a real provider, RoutingProvider
   * doesn't know until call time whether the specific model's route
   * supports streaming, since different labels can route to different
   * underlying providers). Falls back to a plain `complete()` call — with
   * `onDelta` never invoked, so no live preview for that one model, but the
   * call still succeeds normally — when the resolved route's own provider
   * doesn't implement `completeStream`.
   */
  async completeStream(
    config: ModelConfig,
    request: CompletionRequest,
    onDelta: (delta: string) => void,
    opts?: { timeoutMs?: number }
  ): Promise<CompletionResult> {
    const route = this.routes.get(config.id);
    if (!route) {
      throw new Error(`no provider route configured for model "${config.id}"`);
    }
    const apiConfig = { id: route.apiModelId, provider: config.provider };
    if (route.provider.completeStream) {
      return route.provider.completeStream(apiConfig, request, onDelta, opts);
    }
    return route.provider.complete(apiConfig, request);
  }
}

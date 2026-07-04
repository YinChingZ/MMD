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
}

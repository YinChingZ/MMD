export interface ModelConfig {
  /** Model identifier passed straight through to the provider API, e.g. "gpt-4.1". */
  id: string;
  provider: string;
}

export interface CompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  /**
   * Structured context describing which deliberation phase this call belongs to.
   * Providers (in particular MockProvider) key off `meta.phase` instead of
   * parsing prompt text, so mock responses stay decoupled from prompt wording.
   */
  meta: Record<string, unknown>;
}

export interface CompletionUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /**
   * USD cost of this single completion call, when computable — see
   * @mmd/protocol's calculateCostUsd for how providers differ (OpenRouter
   * reports it directly; others are computed from a static rate table or
   * left undefined when the provider/model isn't recognized).
   */
  costUsd?: number;
  /** Raw provider-reported usage object, for provider-specific pricing logic that needs fields beyond the normalized ones above (e.g. DeepSeek's cache hit/miss split). */
  raw?: unknown;
}

export interface CompletionResult {
  text: string;
  latencyMs: number;
  /** Absent only for providers that don't report usage at all — MockProvider always fills this in so cost-accumulation logic can be exercised without a real API key. */
  usage?: CompletionUsage;
}

export interface ModelProvider {
  readonly name: string;
  complete(config: ModelConfig, request: CompletionRequest): Promise<CompletionResult>;
  /**
   * Optional streaming variant, added for M6.3/M6.4. Providers that don't
   * implement it (MockProvider by default, any future provider) keep working
   * exactly as today — every call site checks `provider.completeStream`
   * before using it and falls back to `complete()`. `opts.timeoutMs` is
   * advisory: implementations that make a real network call should tie an
   * AbortController to it so an abandoned stream actually stops instead of
   * continuing to run in the background after the caller has moved on.
   */
  completeStream?(
    config: ModelConfig,
    request: CompletionRequest,
    onDelta: (delta: string) => void,
    opts?: { timeoutMs?: number }
  ): Promise<CompletionResult>;
}

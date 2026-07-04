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

export interface CompletionResult {
  text: string;
  latencyMs: number;
}

export interface ModelProvider {
  readonly name: string;
  complete(config: ModelConfig, request: CompletionRequest): Promise<CompletionResult>;
}

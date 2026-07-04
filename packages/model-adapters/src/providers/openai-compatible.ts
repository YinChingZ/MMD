import type {
  CompletionRequest,
  CompletionResult,
  ModelConfig,
  ModelProvider,
} from "../provider.js";

export interface OpenAICompatibleOptions {
  /** Base URL of an OpenAI-compatible chat completions API. */
  baseUrl?: string;
  /** Env var name holding the API key. Defaults to OPENAI_API_KEY. */
  apiKeyEnvVar?: string;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
}

/**
 * Real provider for any OpenAI-compatible /chat/completions endpoint.
 * No key is configured in this environment yet — wire one up via
 * `apiKeyEnvVar` (or the default OPENAI_API_KEY) before using this for a
 * real run. Until then, use MockProvider to exercise the pipeline.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly name = "openai-compatible";
  private readonly baseUrl: string;
  private readonly apiKeyEnvVar: string;

  constructor(opts: OpenAICompatibleOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
    this.apiKeyEnvVar = opts.apiKeyEnvVar ?? "OPENAI_API_KEY";
  }

  async complete(
    config: ModelConfig,
    request: CompletionRequest
  ): Promise<CompletionResult> {
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(
        `missing API key: set ${this.apiKeyEnvVar} to use ${this.name} for model "${config.id}"`
      );
    }

    const start = Date.now();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.id,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(
        `${this.name} request failed for "${config.id}": ${res.status} ${await res.text()}`
      );
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const text = data.choices[0]?.message.content ?? "";
    return { text, latencyMs: Date.now() - start };
  }
}

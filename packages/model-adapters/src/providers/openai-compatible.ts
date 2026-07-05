import { calculateCostUsd, type UserProvidedRate } from "@mmd/protocol";
import type {
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
  ModelConfig,
  ModelProvider,
} from "../provider.js";

export interface OpenAICompatibleOptions {
  /** Base URL of an OpenAI-compatible chat completions API. */
  baseUrl?: string;
  /** Env var name holding the API key. Defaults to OPENAI_API_KEY. */
  apiKeyEnvVar?: string;
  /** Literal API key (e.g. supplied by a client at request time). Takes precedence over apiKeyEnvVar when set. */
  apiKey?: string;
  /**
   * Provider-whitelist id ("openai" | "deepseek" | "openrouter" | "volcengine")
   * used to pick a cost pricing strategy. Left undefined for the legacy
   * server-registry path, which can point at any OpenAI-compatible endpoint
   * and therefore has no reliable provider identity to price against — usage
   * is still parsed, but costUsd stays undefined ("unknown", not guessed).
   */
  providerId?: string;
  /**
   * A caller-supplied $/1M-token rate, taking priority over the built-in
   * approximate table in @mmd/protocol's pricing.ts (though never over a
   * provider's own real reported cost, e.g. OpenRouter's usage.cost). Lets a
   * BYOK user price a model we don't recognize, or correct a stale built-in
   * rate, without a code change — see docs/protocol.md's M5.1 section.
   */
  pricing?: UserProvidedRate;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: Record<string, unknown>;
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
  private readonly literalApiKey: string | undefined;
  private readonly providerId: string | undefined;
  private readonly pricing: UserProvidedRate | undefined;

  constructor(opts: OpenAICompatibleOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
    this.apiKeyEnvVar = opts.apiKeyEnvVar ?? "OPENAI_API_KEY";
    this.literalApiKey = opts.apiKey;
    this.providerId = opts.providerId;
    this.pricing = opts.pricing;
  }

  async complete(
    config: ModelConfig,
    request: CompletionRequest
  ): Promise<CompletionResult> {
    const apiKey = this.literalApiKey ?? process.env[this.apiKeyEnvVar];
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
    return {
      text,
      latencyMs: Date.now() - start,
      usage: this.parseUsage(data.usage, config.id),
    };
  }

  private parseUsage(
    raw: Record<string, unknown> | undefined,
    modelId: string
  ): CompletionUsage | undefined {
    if (!raw) return undefined;
    const promptTokens = asNumber(raw.prompt_tokens);
    const completionTokens = asNumber(raw.completion_tokens);
    const totalTokens = asNumber(raw.total_tokens);
    const { costUsd } = calculateCostUsd(
      this.providerId,
      { promptTokens, completionTokens, totalTokens, raw },
      modelId,
      this.pricing
    );
    return { promptTokens, completionTokens, totalTokens, costUsd, raw };
  }
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

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
  /** Use OpenAI's native Responses API when a request enables built-in tools. */
  useResponsesApi?: boolean;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: Record<string, unknown>;
}

interface ResponsesApiResponse {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: Record<string, unknown>;
}

function toOpenAiUserContent(request: CompletionRequest) {
  if (typeof request.userPrompt === "string") return request.userPrompt;
  return request.userPrompt.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image_url", image_url: { url: part.imageUrl } }
  );
}

function chatToolsFor(request: CompletionRequest) {
  if (!request.tools?.some((tool) => tool.type === "web_search")) return undefined;
  return [{
    type: "openrouter:web_search",
    parameters: {
      // Keep server-tool context bounded without sharing a cache across models.
      max_results: 5,
      max_total_results: 5,
      search_context_size: "medium",
    },
  }];
}

function toResponsesInput(request: CompletionRequest) {
  const content = typeof request.userPrompt === "string"
    ? [{ type: "input_text", text: request.userPrompt }]
    : request.userPrompt.map((part) =>
        part.type === "text"
          ? { type: "input_text", text: part.text }
          : { type: "input_image", image_url: part.imageUrl }
      );
  return [{ role: "user", content }];
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
  private readonly useResponsesApi: boolean;

  constructor(opts: OpenAICompatibleOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
    this.apiKeyEnvVar = opts.apiKeyEnvVar ?? "OPENAI_API_KEY";
    this.literalApiKey = opts.apiKey;
    this.providerId = opts.providerId;
    this.pricing = opts.pricing;
    this.useResponsesApi = opts.useResponsesApi ?? false;
  }

  async complete(
    config: ModelConfig,
    request: CompletionRequest
  ): Promise<CompletionResult> {
    if (request.tools?.some((tool) => tool.type === "web_search")) {
      if (!this.useResponsesApi) {
        if (this.providerId !== "openrouter") {
          throw new Error("web search requires a direct OpenAI Responses API or OpenRouter provider");
        }
      } else {
        return this.completeWithResponses(config, request);
      }
    }
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
          { role: "user", content: toOpenAiUserContent(request) },
        ],
        ...(chatToolsFor(request) ? { tools: chatToolsFor(request) } : {}),
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

  async completeStream(
    config: ModelConfig,
    request: CompletionRequest,
    onDelta: (delta: string) => void,
    opts?: { timeoutMs?: number }
  ): Promise<CompletionResult> {
    // Responses API tool runs are complete server-side and this first version
    // intentionally does not parse its event stream. Returning the settled
    // response preserves structured-output validation and quorum behavior.
    if (this.useResponsesApi && request.tools?.some((tool) => tool.type === "web_search")) {
      return this.complete(config, request);
    }
    const apiKey = this.literalApiKey ?? process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(
        `missing API key: set ${this.apiKeyEnvVar} to use ${this.name} for model "${config.id}"`
      );
    }

    const controller = new AbortController();
    const timer = opts?.timeoutMs
      ? setTimeout(() => controller.abort(), opts.timeoutMs)
      : undefined;
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.id,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: toOpenAiUserContent(request) },
          ],
          ...(chatToolsFor(request) ? { tools: chatToolsFor(request) } : {}),
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(
          `${this.name} stream request failed for "${config.id}": ${res.status} ${await res
            .text()
            .catch(() => "")}`
        );
      }

      let text = "";
      let usageRaw: Record<string, unknown> | undefined;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            text += delta;
            onDelta(delta);
          }
          if (chunk.usage) usageRaw = chunk.usage;
        }
      }

      return {
        text,
        latencyMs: Date.now() - start,
        usage: this.parseUsage(usageRaw, config.id),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
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

  private async completeWithResponses(
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
    const res = await fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.id,
        instructions: request.systemPrompt,
        input: toResponsesInput(request),
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
        max_tool_calls: 1,
        store: false,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `${this.name} Responses API request failed for "${config.id}": ${res.status} ${await res.text()}`
      );
    }
    const data = (await res.json()) as ResponsesApiResponse;
    const text = data.output_text ?? data.output
      ?.flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text ?? "")
      .join("") ?? "";
    const tokenUsage = data.usage
      ? this.parseUsage(
          {
            prompt_tokens: data.usage.input_tokens,
            completion_tokens: data.usage.output_tokens,
            total_tokens: data.usage.total_tokens,
          },
          config.id
        )
      : undefined;
    const toolCalls = (data.output ?? [])
      .filter((item) => item.type === "web_search_call")
      .map(() => ({ type: "web_search" }));
    // OpenAI lists native web search at $10 / 1,000 calls. This is added to
    // the normal token estimate so M5.1's circuit breaker does not ignore the
    // tool's fixed per-call charge.
    const usage = tokenUsage
      ? { ...tokenUsage, costUsd: (tokenUsage.costUsd ?? 0) + toolCalls.length * 0.01 }
      : tokenUsage;
    return {
      text,
      latencyMs: Date.now() - start,
      usage,
      toolCalls,
    };
  }
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

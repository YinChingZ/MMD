import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../src/providers/openai-compatible.js";

function fakeResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/** Builds a fake fetch Response whose `.body` is a Web-Streams reader
 * yielding the given raw SSE text in one or more chunks, mimicking a real
 * `/chat/completions` `stream: true` response. */
function fakeSseResponse(rawChunks: string[], ok = true, status = 200) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok,
    status,
    text: async () => rawChunks.join(""),
    body: {
      getReader() {
        return {
          async read() {
            if (i >= rawChunks.length) return { done: true, value: undefined };
            const value = encoder.encode(rawChunks[i]);
            i++;
            return { done: false, value };
          },
        };
      },
    },
  } as unknown as Response;
}

function sseFrame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

describe("OpenAICompatibleProvider", () => {
  const request = { systemPrompt: "s", userPrompt: "hello", meta: {} };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.TEST_ENV_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a literal apiKey when provided, without touching env vars", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      fakeResponse({ choices: [{ message: { content: "hi" } }] })
    );

    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.com/v1",
      apiKey: "literal-key-value",
    });

    const result = await provider.complete(
      { id: "some-model", provider: "openai-compatible" },
      request
    );

    expect(result.text).toBe("hi");
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer literal-key-value"
    );
  });

  it("falls back to apiKeyEnvVar when no literal key is given", async () => {
    process.env.TEST_ENV_KEY = "from-env";
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      fakeResponse({ choices: [{ message: { content: "hi" } }] })
    );

    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.com/v1",
      apiKeyEnvVar: "TEST_ENV_KEY",
    });

    await provider.complete(
      { id: "some-model", provider: "openai-compatible" },
      request
    );

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer from-env"
    );
  });

  it("prefers the literal apiKey over apiKeyEnvVar when both are given", async () => {
    process.env.TEST_ENV_KEY = "from-env";
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      fakeResponse({ choices: [{ message: { content: "hi" } }] })
    );

    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.com/v1",
      apiKeyEnvVar: "TEST_ENV_KEY",
      apiKey: "literal-wins",
    });

    await provider.complete(
      { id: "some-model", provider: "openai-compatible" },
      request
    );

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer literal-wins"
    );
  });

  it("throws a clear error when neither a literal key nor a resolvable env var is set", async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.com/v1",
      apiKeyEnvVar: "MISSING_ENV_KEY",
    });

    await expect(
      provider.complete(
        { id: "some-model", provider: "openai-compatible" },
        request
      )
    ).rejects.toThrow(/missing API key/);
  });

  it("has no usage when the response doesn't include one", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      fakeResponse({ choices: [{ message: { content: "hi" } }] })
    );
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.com/v1",
      apiKey: "k",
    });

    const result = await provider.complete(
      { id: "some-model", provider: "openai-compatible" },
      request
    );
    expect(result.usage).toBeUndefined();
  });

  it("openrouter: reads usage.cost as an exact cost", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      fakeResponse({
        choices: [{ message: { content: "hi" } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
          cost: 0.00042,
        },
      })
    );
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "k",
      providerId: "openrouter",
    });

    const result = await provider.complete(
      { id: "some-model", provider: "openrouter" },
      request
    );
    expect(result.usage?.promptTokens).toBe(10);
    expect(result.usage?.completionTokens).toBe(20);
    expect(result.usage?.costUsd).toBe(0.00042);
  });

  it("no providerId (legacy registry path): parses token counts but never guesses a cost", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      fakeResponse({
        choices: [{ message: { content: "hi" } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      })
    );
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.com/v1",
      apiKey: "k",
    });

    const result = await provider.complete(
      { id: "some-model", provider: "openai-compatible" },
      request
    );
    expect(result.usage?.promptTokens).toBe(10);
    expect(result.usage?.costUsd).toBeUndefined();
  });

  it("a caller-supplied pricing rate prices an otherwise-unrecognized provider", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      fakeResponse({
        choices: [{ message: { content: "hi" } }],
        usage: {
          prompt_tokens: 1_000_000,
          completion_tokens: 1_000_000,
          total_tokens: 2_000_000,
        },
      })
    );
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.com/v1",
      apiKey: "k",
      // no providerId — this provider is unrecognized on its own
      pricing: { inputPerMillion: 1, outputPerMillion: 2 },
    });

    const result = await provider.complete(
      { id: "some-model", provider: "openai-compatible" },
      request
    );
    expect(result.usage?.costUsd).toBeCloseTo(3, 5);
  });

  it("a caller-supplied pricing rate does not override OpenRouter's own real reported cost", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      fakeResponse({
        choices: [{ message: { content: "hi" } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.001 },
      })
    );
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "k",
      providerId: "openrouter",
      pricing: { inputPerMillion: 999, outputPerMillion: 999 },
    });

    const result = await provider.complete(
      { id: "some-model", provider: "openrouter" },
      request
    );
    expect(result.usage?.costUsd).toBe(0.001);
  });

  it("completeStream: reconstructs text from delta chunks and calls onDelta for each one", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      fakeSseResponse([
        sseFrame({ choices: [{ delta: { content: "Hel" } }] }),
        sseFrame({ choices: [{ delta: { content: "lo " } }] }),
        sseFrame({ choices: [{ delta: { content: "world" } }] }),
        sseFrame({
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
        "data: [DONE]\n\n",
      ])
    );
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.com/v1",
      apiKey: "k",
    });

    const deltas: string[] = [];
    const result = await provider.completeStream!(
      { id: "some-model", provider: "openai-compatible" },
      request,
      (delta) => deltas.push(delta)
    );

    expect(deltas).toEqual(["Hel", "lo ", "world"]);
    expect(result.text).toBe("Hello world");
    expect(result.usage?.promptTokens).toBe(5);
  });

  it("completeStream: sets stream:true and stream_options.include_usage in the request body", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      fakeSseResponse([sseFrame({ choices: [{ delta: { content: "hi" } }] }), "data: [DONE]\n\n"])
    );
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.com/v1",
      apiKey: "k",
    });

    await provider.completeStream!(
      { id: "some-model", provider: "openai-compatible" },
      request,
      () => {}
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("completeStream: aborts the underlying request when timeoutMs elapses", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    });
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.com/v1",
      apiKey: "k",
    });

    await expect(
      provider.completeStream!(
        { id: "some-model", provider: "openai-compatible" },
        request,
        () => {},
        { timeoutMs: 5 }
      )
    ).rejects.toThrow();
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).signal?.aborted).toBe(true);
  });
});

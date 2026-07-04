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
});

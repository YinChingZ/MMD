import { MockProvider, RoutingProvider } from "@mmd/model-adapters";
import type { ModelProvider } from "@mmd/model-adapters";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildProvider,
  buildRunProvider,
  type ResolvedProvider,
} from "../src/config/provider-factory.js";

function fakeProvider(name: string): ModelProvider {
  return {
    name,
    async complete(config, request) {
      return {
        text: `${name}:${config.id}:${request.userPrompt}`,
        latencyMs: 0,
      };
    },
  };
}

function fakeLegacyResolvedProvider(): ResolvedProvider {
  return {
    provider: new RoutingProvider(
      new Map([
        ["model_a", { provider: fakeProvider("legacy_vendor"), apiModelId: "real-a" }],
        ["model_b", { provider: fakeProvider("legacy_vendor"), apiModelId: "real-b" }],
      ])
    ),
    availableModelIds: ["model_a", "model_b"],
    coordinatorModelId: "model_a",
    isMock: false,
    modelIdToProviderLabel: () => "legacy-vendor",
  };
}

describe("buildProvider", () => {
  it("falls back to MockProvider with a default 3-model roster when no models config is given", () => {
    const resolved = buildProvider(undefined);
    expect(resolved.isMock).toBe(true);
    expect(resolved.provider).toBeInstanceOf(MockProvider);
    expect(resolved.availableModelIds).toEqual([
      "model_a",
      "model_b",
      "model_c",
    ]);
  });

  it("builds a RoutingProvider keyed by the configured model ids when a models config is given", () => {
    const resolved = buildProvider({
      coordinatorModelId: "model_b",
      models: [
        {
          id: "model_a",
          modelId: "gpt-4.1",
          baseUrl: "https://api.openai.com/v1",
          apiKeyEnvVar: "A_KEY",
        },
        {
          id: "model_b",
          modelId: "some-model",
          baseUrl: "https://example.com/v1",
          apiKeyEnvVar: "B_KEY",
        },
      ],
    });

    expect(resolved.isMock).toBe(false);
    expect(resolved.provider).toBeInstanceOf(RoutingProvider);
    expect(resolved.availableModelIds).toEqual(["model_a", "model_b"]);
    expect(resolved.coordinatorModelId).toBe("model_b");
  });

  it("defaults coordinatorModelId to the first configured model when not specified", () => {
    const resolved = buildProvider({
      models: [
        {
          id: "model_a",
          modelId: "gpt-4.1",
          baseUrl: "https://api.openai.com/v1",
          apiKeyEnvVar: "A_KEY",
        },
      ],
    });
    expect(resolved.coordinatorModelId).toBe("model_a");
  });
});

describe("buildRunProvider", () => {
  const request = { systemPrompt: "s", userPrompt: "hello", meta: {} };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches a selected legacy id through the legacy provider unchanged", async () => {
    const legacy = fakeLegacyResolvedProvider();
    const run = buildRunProvider({
      legacy,
      selectedLegacyIds: ["model_a"],
      byokModels: [],
    });

    const result = await run.provider.complete(
      { id: "model_a", provider: "irrelevant" },
      request
    );
    expect(result.text).toBe("legacy_vendor:real-a:hello");
    expect(run.models).toEqual([{ id: "model_a", provider: "legacy-vendor" }]);
    expect(run.coordinatorModelId).toBe("model_a");
  });

  it("dispatches a byok entry to a fresh OpenAICompatibleProvider using the caller's own key", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "byok reply" } }] }),
      text: async () => "",
    });

    const legacy = fakeLegacyResolvedProvider();
    const run = buildRunProvider({
      legacy,
      selectedLegacyIds: [],
      byokModels: [
        {
          label: "byok_openai",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-caller-key",
          modelId: "gpt-4.1-mini",
          providerLabel: "OpenAI",
        },
      ],
    });

    const result = await run.provider.complete(
      { id: "byok_openai", provider: "irrelevant" },
      request
    );
    expect(result.text).toBe("byok reply");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-caller-key"
    );
    expect(JSON.parse(init.body as string).model).toBe("gpt-4.1-mini");
    expect(run.modelIdToProviderLabel("byok_openai")).toBe("OpenAI");
  });

  it("mixes selected legacy ids and byok entries in one run", async () => {
    const legacy = fakeLegacyResolvedProvider();
    const run = buildRunProvider({
      legacy,
      selectedLegacyIds: ["model_b"],
      byokModels: [
        {
          label: "byok_deepseek",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "sk-caller-key",
          modelId: "deepseek-chat",
          providerLabel: "DeepSeek",
        },
      ],
    });

    expect(run.models).toEqual([
      { id: "model_b", provider: "legacy-vendor" },
      { id: "byok_deepseek", provider: "DeepSeek" },
    ]);
  });

  it("passes providerId through so the byok model's usage can be priced (M5.1)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "byok reply" } }],
        usage: { prompt_tokens: 100, completion_tokens: 100, cost: 0.0007 },
      }),
      text: async () => "",
    });

    const legacy = fakeLegacyResolvedProvider();
    const run = buildRunProvider({
      legacy,
      selectedLegacyIds: [],
      byokModels: [
        {
          label: "byok_openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "sk-caller-key",
          modelId: "some/model",
          providerLabel: "OpenRouter",
          providerId: "openrouter",
        },
      ],
    });

    const result = await run.provider.complete(
      { id: "byok_openrouter", provider: "irrelevant" },
      request
    );
    // OpenRouter's usage.cost is authoritative — providerId being threaded
    // through is what lets the pricing strategy pick it up at all.
    expect(result.usage?.costUsd).toBe(0.0007);
  });

  it("omitting providerId (legacy path or an unresolvable provider) never fabricates a cost", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "byok reply" } }],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      }),
      text: async () => "",
    });

    const legacy = fakeLegacyResolvedProvider();
    const run = buildRunProvider({
      legacy,
      selectedLegacyIds: [],
      byokModels: [
        {
          label: "byok_unknown",
          baseUrl: "https://example.com/v1",
          apiKey: "sk-caller-key",
          modelId: "some-model",
          providerLabel: "Example",
        },
      ],
    });

    const result = await run.provider.complete(
      { id: "byok_unknown", provider: "irrelevant" },
      request
    );
    expect(result.usage?.promptTokens).toBe(100);
    expect(result.usage?.costUsd).toBeUndefined();
  });

  it("M5.1: a caller-supplied pricing rate prices an otherwise-unrecognized provider", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "byok reply" } }],
        usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
      }),
      text: async () => "",
    });

    const legacy = fakeLegacyResolvedProvider();
    const run = buildRunProvider({
      legacy,
      selectedLegacyIds: [],
      byokModels: [
        {
          label: "byok_custom",
          baseUrl: "https://example.com/v1",
          apiKey: "sk-caller-key",
          modelId: "some-model",
          providerLabel: "Example",
          // no providerId — unrecognized on its own
          pricing: { inputPerMillion: 1, outputPerMillion: 4 },
        },
      ],
    });

    const result = await run.provider.complete(
      { id: "byok_custom", provider: "irrelevant" },
      request
    );
    expect(result.usage?.costUsd).toBeCloseTo(5, 5);
  });

  it("throws when byokModels contains duplicate labels", () => {
    const legacy = fakeLegacyResolvedProvider();
    expect(() =>
      buildRunProvider({
        legacy,
        selectedLegacyIds: [],
        byokModels: [
          {
            label: "dup",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "k1",
            modelId: "m1",
            providerLabel: "OpenAI",
          },
          {
            label: "dup",
            baseUrl: "https://api.deepseek.com/v1",
            apiKey: "k2",
            modelId: "m2",
            providerLabel: "DeepSeek",
          },
        ],
      })
    ).toThrow(/duplicate labels/);
  });

  it("throws when a byok label collides with a selected legacy id", () => {
    const legacy = fakeLegacyResolvedProvider();
    expect(() =>
      buildRunProvider({
        legacy,
        selectedLegacyIds: ["model_a"],
        byokModels: [
          {
            label: "model_a",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "k1",
            modelId: "m1",
            providerLabel: "OpenAI",
          },
        ],
      })
    ).toThrow(/used by both the server registry and byokModels/);
  });
});

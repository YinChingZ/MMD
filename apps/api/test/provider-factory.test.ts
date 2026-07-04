import { MockProvider, RoutingProvider } from "@mmd/model-adapters";
import { describe, expect, it } from "vitest";
import { buildProvider } from "../src/config/provider-factory.js";

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

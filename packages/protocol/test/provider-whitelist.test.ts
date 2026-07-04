import { describe, expect, it } from "vitest";
import {
  getProviderBaseUrl,
  getProviderDisplayName,
  isWhitelistedProvider,
  PROVIDER_WHITELIST,
} from "../src/provider-whitelist.js";

describe("provider whitelist (BYOK)", () => {
  it("every entry has a fixed https baseUrl", () => {
    expect(PROVIDER_WHITELIST.length).toBeGreaterThan(0);
    for (const entry of PROVIDER_WHITELIST) {
      expect(entry.baseUrl).toMatch(/^https:\/\//);
    }
  });

  it("has no duplicate providerIds", () => {
    const ids = PROVIDER_WHITELIST.map((p) => p.providerId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("isWhitelistedProvider is true only for known providers", () => {
    expect(isWhitelistedProvider("openai")).toBe(true);
    expect(isWhitelistedProvider("anthropic")).toBe(false);
    expect(isWhitelistedProvider("some-random-self-hosted-thing")).toBe(false);
  });

  it("getProviderBaseUrl/getProviderDisplayName resolve known providers and return undefined for unknown ones", () => {
    expect(getProviderBaseUrl("openai")).toBe("https://api.openai.com/v1");
    expect(getProviderDisplayName("openai")).toBe("OpenAI");
    expect(getProviderBaseUrl("not-a-provider")).toBeUndefined();
    expect(getProviderDisplayName("not-a-provider")).toBeUndefined();
  });
});

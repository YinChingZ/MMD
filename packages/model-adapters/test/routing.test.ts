import { describe, expect, it } from "vitest";
import { RoutingProvider } from "../src/providers/routing.js";
import type { CompletionRequest, ModelConfig, ModelProvider } from "../src/provider.js";

function fakeProvider(name: string): ModelProvider {
  return {
    name,
    async complete(config, request) {
      return { text: `${name}:${config.id}:${request.userPrompt}`, latencyMs: 0 };
    },
  };
}

describe("RoutingProvider", () => {
  it("dispatches each model label to its own provider and substitutes the real API model id", async () => {
    const routing = new RoutingProvider(
      new Map([
        ["model_a", { provider: fakeProvider("vendor_x"), apiModelId: "gpt-4.1" }],
        ["model_b", { provider: fakeProvider("vendor_y"), apiModelId: "claude-sonnet" }],
      ])
    );

    const request: CompletionRequest = {
      systemPrompt: "s",
      userPrompt: "hello",
      meta: {},
    };

    const a = await routing.complete({ id: "model_a", provider: "routing" }, request);
    expect(a.text).toBe("vendor_x:gpt-4.1:hello");

    const b = await routing.complete({ id: "model_b", provider: "routing" }, request);
    expect(b.text).toBe("vendor_y:claude-sonnet:hello");
  });

  it("throws a clear error for an unconfigured model label", async () => {
    const routing = new RoutingProvider(new Map());
    await expect(
      routing.complete(
        { id: "model_z", provider: "routing" },
        { systemPrompt: "", userPrompt: "", meta: {} }
      )
    ).rejects.toThrow(/no provider route configured/);
  });
});

describe("RoutingProvider — M6.3/M6.4 completeStream forwarding", () => {
  const request: CompletionRequest = { systemPrompt: "s", userPrompt: "hello", meta: {} };

  function fakeStreamingProvider(name: string): ModelProvider {
    return {
      name,
      async complete(config, req) {
        return { text: `${name}:${config.id}:${req.userPrompt}`, latencyMs: 0 };
      },
      async completeStream(config, req, onDelta) {
        onDelta("chunk1-");
        onDelta("chunk2");
        return { text: `${name}:${config.id}:streamed`, latencyMs: 0 };
      },
    };
  }

  it("delegates to the resolved route's completeStream when it has one, substituting the real API model id", async () => {
    const routing = new RoutingProvider(
      new Map([["model_a", { provider: fakeStreamingProvider("vendor_x"), apiModelId: "gpt-4.1" }]])
    );
    const deltas: string[] = [];
    const result = await routing.completeStream(
      { id: "model_a", provider: "routing" },
      request,
      (d) => deltas.push(d)
    );
    expect(deltas).toEqual(["chunk1-", "chunk2"]);
    expect(result.text).toBe("vendor_x:gpt-4.1:streamed");
  });

  it("falls back to a plain complete() call (no onDelta invocations) when the route's provider doesn't implement completeStream", async () => {
    const routing = new RoutingProvider(
      new Map([["model_a", { provider: fakeProvider("vendor_x"), apiModelId: "gpt-4.1" }]])
    );
    const deltas: string[] = [];
    const result = await routing.completeStream(
      { id: "model_a", provider: "routing" },
      request,
      (d) => deltas.push(d)
    );
    expect(deltas).toEqual([]);
    expect(result.text).toBe("vendor_x:gpt-4.1:hello");
  });

  it("throws a clear error for an unconfigured model label", async () => {
    const routing = new RoutingProvider(new Map());
    await expect(
      routing.completeStream({ id: "model_z", provider: "routing" }, request, () => {})
    ).rejects.toThrow(/no provider route configured/);
  });
});

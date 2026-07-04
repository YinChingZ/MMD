import { describe, expect, it } from "vitest";
import { fanOutWithQuorum } from "../src/fanout.js";
import type { ModelConfig } from "../src/provider.js";

const configs: ModelConfig[] = [
  { id: "model_a", provider: "mock" },
  { id: "model_b", provider: "mock" },
  { id: "model_c", provider: "mock" },
];

describe("fanOutWithQuorum (M0 risk #4: single-model failure must not fail the whole run)", () => {
  it("all succeed -> quorum met, not partial", async () => {
    const outcome = await fanOutWithQuorum(
      configs,
      async (config) => `ok:${config.id}`,
      { timeoutMs: 100, retries: 0, backoffMs: 1 }
    );
    expect(outcome.succeeded).toHaveLength(3);
    expect(outcome.quorum.met).toBe(true);
    expect(outcome.quorum.partial).toBe(false);
  });

  it("one model fails -> fan-out still resolves, quorum met but partial", async () => {
    const outcome = await fanOutWithQuorum(
      configs,
      async (config) => {
        if (config.id === "model_c") throw new Error("simulated failure");
        return `ok:${config.id}`;
      },
      { timeoutMs: 100, retries: 0, backoffMs: 1 }
    );
    expect(outcome.succeeded).toHaveLength(2);
    expect(outcome.quorum.met).toBe(true);
    expect(outcome.quorum.partial).toBe(true);
    const failure = outcome.results.find((r) => !r.ok);
    expect(failure?.ok).toBe(false);
  });

  it("two of three models fail -> quorum not met", async () => {
    const outcome = await fanOutWithQuorum(
      configs,
      async (config) => {
        if (config.id !== "model_a") throw new Error("simulated failure");
        return `ok:${config.id}`;
      },
      { timeoutMs: 100, retries: 0, backoffMs: 1 }
    );
    expect(outcome.succeeded).toHaveLength(1);
    expect(outcome.quorum.met).toBe(false);
  });

  it("a slow model times out and does not block the others", async () => {
    const outcome = await fanOutWithQuorum(
      configs,
      async (config) => {
        if (config.id === "model_b") {
          await new Promise((r) => setTimeout(r, 200));
        }
        return `ok:${config.id}`;
      },
      { timeoutMs: 20, retries: 0, backoffMs: 1 }
    );
    expect(outcome.succeeded.map((s) => s.config.id).sort()).toEqual([
      "model_a",
      "model_c",
    ]);
    expect(outcome.quorum.partial).toBe(true);
  });
});

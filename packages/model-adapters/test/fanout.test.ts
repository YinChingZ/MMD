import { describe, expect, it } from "vitest";
import { fanOutWithQuorum } from "../src/fanout.js";
import type { FanoutResult } from "../src/fanout.js";
import type { ModelConfig } from "../src/provider.js";

const configs: ModelConfig[] = [
  { id: "model_a", provider: "mock" },
  { id: "model_b", provider: "mock" },
  { id: "model_c", provider: "mock" },
];

describe("fanOutWithQuorum (M0 risk #4: single-model failure must not fail the whole run)", () => {
  it("does not retry an error explicitly marked non-retryable", async () => {
    let calls = 0;
    const error = Object.assign(new Error("authentication failed"), { retryable: false });
    const outcome = await fanOutWithQuorum(
      [configs[0]],
      async () => {
        calls++;
        throw error;
      },
      { timeoutMs: 100, retries: 1, backoffMs: 1 },
    );
    expect(calls).toBe(1);
    expect(outcome.succeeded).toHaveLength(0);
  });

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

describe("fanOutWithQuorum onSettled (M6.2: per-model progress events)", () => {
  it("fires per-model as each settles, before the slow model resolves", async () => {
    const settleOrder: string[] = [];
    await fanOutWithQuorum(
      configs,
      async (config) => {
        if (config.id === "model_b") {
          await new Promise((r) => setTimeout(r, 50));
        }
        return `ok:${config.id}`;
      },
      {
        timeoutMs: 200,
        retries: 0,
        backoffMs: 1,
        onSettled: (result) => settleOrder.push(result.config.id),
      }
    );
    expect(settleOrder).toHaveLength(3);
    const bIndex = settleOrder.indexOf("model_b");
    const aIndex = settleOrder.indexOf("model_a");
    const cIndex = settleOrder.indexOf("model_c");
    expect(aIndex).toBeLessThan(bIndex);
    expect(cIndex).toBeLessThan(bIndex);
  });

  it("fires for both success and failure with correct ok/error", async () => {
    const settled: FanoutResult<unknown>[] = [];
    await fanOutWithQuorum(
      configs,
      async (config) => {
        if (config.id === "model_c") throw new Error("simulated failure");
        return `ok:${config.id}`;
      },
      {
        timeoutMs: 100,
        retries: 0,
        backoffMs: 1,
        onSettled: (result) => settled.push(result),
      }
    );
    expect(settled).toHaveLength(3);
    const failure = settled.find((r) => r.config.id === "model_c");
    expect(failure?.ok).toBe(false);
    expect(!failure?.ok && failure.error.message).toBe("simulated failure");
    const successes = settled.filter((r) => r.config.id !== "model_c");
    expect(successes.every((r) => r.ok)).toBe(true);
  });

  it("reports a stable index/total for every call", async () => {
    const calls: { index: number; total: number }[] = [];
    await fanOutWithQuorum(
      configs,
      async (config) => `ok:${config.id}`,
      {
        timeoutMs: 100,
        retries: 0,
        backoffMs: 1,
        onSettled: (_result, index, total) => calls.push({ index, total }),
      }
    );
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.total === 3)).toBe(true);
    expect(calls.map((c) => c.index).sort()).toEqual([0, 1, 2]);
  });

  it("latencyMs reflects the timed-out model's bound, not the full delay", async () => {
    const latencies: Record<string, number> = {};
    await fanOutWithQuorum(
      configs,
      async (config) => {
        if (config.id === "model_b") {
          await new Promise((r) => setTimeout(r, 200));
        }
        return `ok:${config.id}`;
      },
      {
        timeoutMs: 20,
        retries: 0,
        backoffMs: 1,
        onSettled: (result) => {
          latencies[result.config.id] = result.latencyMs;
        },
      }
    );
    expect(latencies.model_b).toBeGreaterThanOrEqual(20);
    expect(latencies.model_b).toBeLessThan(200);
    expect(latencies.model_a).toBeLessThan(20);
    expect(latencies.model_c).toBeLessThan(20);
  });
});

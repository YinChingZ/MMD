import { describe, expect, it, vi } from "vitest";
import { withRetry, withTimeout } from "../src/resilience.js";

describe("withTimeout", () => {
  it("resolves when the promise finishes before the timeout", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50, "test")).resolves.toBe(
      "ok"
    );
  });

  it("rejects when the promise is slower than the timeout", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 100));
    await expect(withTimeout(slow, 10, "test")).rejects.toThrow(/timeout/);
  });
});

describe("withRetry", () => {
  it("returns the first successful result without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, { retries: 3, backoffMs: 1 })).resolves.toBe(
      "ok"
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to `retries` times then succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
      return "ok";
    });
    await expect(withRetry(fn, { retries: 3, backoffMs: 1 })).resolves.toBe(
      "ok"
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error once retries are exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(withRetry(fn, { retries: 2, backoffMs: 1 })).rejects.toThrow(
      "always fails"
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

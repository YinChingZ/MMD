import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callStructured } from "../src/structured.js";

const schema = z.object({ ok: z.boolean(), n: z.number() });

describe("callStructured (structured-output retry/repair loop)", () => {
  it("parses valid JSON on the first attempt", async () => {
    const complete = vi.fn().mockResolvedValue({ text: '{"ok": true, "n": 1}' });
    const result = await callStructured(complete, schema);
    expect(result).toEqual({ ok: true, n: 1 });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("unwraps a fenced ```json code block", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ text: '```json\n{"ok": true, "n": 2}\n```' });
    const result = await callStructured(complete, schema);
    expect(result).toEqual({ ok: true, n: 2 });
  });

  it("retries with a repair note after invalid JSON, then succeeds", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: "not json at all" })
      .mockResolvedValueOnce({ text: '{"ok": true, "n": 3}' });
    const result = await callStructured(complete, schema, {
      maxRepairAttempts: 2,
    });
    expect(result).toEqual({ ok: true, n: 3 });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0]).toMatch(/failed JSON schema validation/);
  });

  it("retries after a schema mismatch, then succeeds", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: '{"ok": "yes", "n": 1}' })
      .mockResolvedValueOnce({ text: '{"ok": true, "n": 1}' });
    const result = await callStructured(complete, schema);
    expect(result).toEqual({ ok: true, n: 1 });
  });

  it("throws once maxRepairAttempts is exhausted", async () => {
    const complete = vi.fn().mockResolvedValue({ text: "still not json" });
    await expect(
      callStructured(complete, schema, { maxRepairAttempts: 1 })
    ).rejects.toThrow(/failed schema validation/);
    expect(complete).toHaveBeenCalledTimes(2);
  });
});

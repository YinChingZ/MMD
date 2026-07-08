import { describe, expect, it, vi } from "vitest";
import { callJsonSchema } from "../src/json-schema-output.js";

const schema = {
  type: "object",
  required: ["winner", "confidence"],
  properties: {
    winner: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  additionalProperties: false,
} as const;

describe("callJsonSchema (user-defined JSON output retry/repair loop)", () => {
  it("validates valid JSON on the first attempt", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ text: '{"winner": "A", "confidence": "high"}' });
    const result = await callJsonSchema(complete, schema);
    expect(result).toEqual({ winner: "A", confidence: "high" });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("unwraps a fenced ```json code block", async () => {
    const complete = vi.fn().mockResolvedValue({
      text: '```json\n{"winner": "B", "confidence": "medium"}\n```',
    });
    const result = await callJsonSchema(complete, schema);
    expect(result).toEqual({ winner: "B", confidence: "medium" });
  });

  it("retries with a repair note after invalid JSON, then succeeds", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: "not json at all" })
      .mockResolvedValueOnce({ text: '{"winner": "A", "confidence": "low"}' });
    const result = await callJsonSchema(complete, schema, {
      maxRepairAttempts: 2,
    });
    expect(result).toEqual({ winner: "A", confidence: "low" });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0]).toMatch(/failed JSON schema validation/);
  });

  it("retries after a schema mismatch (bad enum value), then succeeds", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: '{"winner": "A", "confidence": "very high"}' })
      .mockResolvedValueOnce({ text: '{"winner": "A", "confidence": "high"}' });
    const result = await callJsonSchema(complete, schema);
    expect(result).toEqual({ winner: "A", confidence: "high" });
  });

  it("throws once maxRepairAttempts is exhausted", async () => {
    const complete = vi.fn().mockResolvedValue({ text: "still not json" });
    await expect(
      callJsonSchema(complete, schema, { maxRepairAttempts: 1 })
    ).rejects.toThrow(/failed schema validation/);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("throws with the validation error message when a required field is missing", async () => {
    const complete = vi.fn().mockResolvedValue({ text: '{"winner": "A"}' });
    await expect(
      callJsonSchema(complete, schema, { maxRepairAttempts: 0 })
    ).rejects.toThrow(/confidence/);
  });
});

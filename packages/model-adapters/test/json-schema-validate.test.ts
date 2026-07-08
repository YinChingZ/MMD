import { describe, expect, it } from "vitest";
import { validateOutputFormatSchema } from "../src/json-schema-validate.js";

describe("validateOutputFormatSchema (M6.1 v1 schema subset)", () => {
  it("accepts a typical object schema within the supported subset", () => {
    const result = validateOutputFormatSchema({
      type: "object",
      required: ["winner", "reasons"],
      properties: {
        winner: { type: "string" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        reasons: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a non-object schema", () => {
    const result = validateOutputFormatSchema("not a schema");
    expect(result.ok).toBe(false);
  });

  it("rejects $ref", () => {
    const result = validateOutputFormatSchema({
      type: "object",
      properties: { a: { $ref: "#/definitions/Foo" } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/\$ref/);
  });

  it("rejects unsupported keywords like oneOf", () => {
    const result = validateOutputFormatSchema({
      type: "object",
      oneOf: [{ type: "string" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/oneOf/);
  });

  it("rejects unsupported types", () => {
    const result = validateOutputFormatSchema({ type: "banana" });
    expect(result.ok).toBe(false);
  });

  it("rejects schemas nested deeper than the max depth", () => {
    let node: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 8; i++) {
      node = { type: "object", properties: { nested: node } };
    }
    const result = validateOutputFormatSchema(node);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/depth/);
  });

  it("rejects schemas over the size limit", () => {
    const bigEnum = Array.from({ length: 5000 }, (_, i) => `value_${i}`);
    const result = validateOutputFormatSchema({
      type: "string",
      enum: bigEnum,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/);
  });
});

import { describe, expect, it } from "vitest";
import { parseOutputSchema } from "../src/lib/output-schema";

describe("parseOutputSchema", () => {
  it("returns undefined outputFormat for blank text", () => {
    expect(parseOutputSchema("  \n")).toEqual({
      ok: true,
      outputFormat: undefined,
    });
  });

  it("wraps a valid object schema", () => {
    const result = parseOutputSchema('{"type":"object"}');
    expect(result).toEqual({
      ok: true,
      outputFormat: { type: "json_schema", schema: { type: "object" } },
    });
  });

  it("rejects arrays", () => {
    const result = parseOutputSchema("[1,2]");
    expect(result.ok).toBe(false);
  });

  it("rejects invalid JSON with an error message", () => {
    const result = parseOutputSchema("{nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});

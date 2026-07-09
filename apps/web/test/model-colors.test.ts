import { describe, expect, it } from "vitest";
import {
  modelColor,
  modelDisplayName,
  modelInitials,
} from "../src/lib/model-colors";

describe("modelColor", () => {
  it("is deterministic for the same model id", () => {
    expect(modelColor("openai/gpt-4o")).toEqual(modelColor("openai/gpt-4o"));
  });

  it("returns oklch color strings", () => {
    const { bg, fg } = modelColor("anthropic/claude-sonnet-5");
    expect(bg).toMatch(/^oklch\(/);
    expect(fg).toMatch(/^oklch\(/);
  });

  it("distributes different ids across hues", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const hues = new Set(ids.map((id) => modelColor(id).fg));
    expect(hues.size).toBeGreaterThan(1);
  });
});

describe("modelInitials", () => {
  it("takes first letters of two segments", () => {
    expect(modelInitials("openai/gpt-4o")).toBe("G4");
    expect(modelInitials("claude-sonnet-5")).toBe("CS");
  });

  it("handles single-segment names", () => {
    expect(modelInitials("mock")).toBe("MO");
  });

  it("handles empty-ish input", () => {
    expect(modelInitials("---")).toBe("?");
  });
});

describe("modelDisplayName", () => {
  it("strips provider prefix", () => {
    expect(modelDisplayName("openrouter/deepseek-v3")).toBe("deepseek-v3");
    expect(modelDisplayName("plain-model")).toBe("plain-model");
  });
});

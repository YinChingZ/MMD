import { describe, expect, it } from "vitest";
import { OutlineResultSchema } from "../src/schemas/outline.js";

function topics(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    topic_id: `t${i}`,
    title: `Topic ${i}`,
    description: `Scope for topic ${i}`,
  }));
}

describe("OutlineResultSchema", () => {
  it("accepts between 1 and 8 topics", () => {
    expect(OutlineResultSchema.safeParse({ topics: topics(1) }).success).toBe(
      true
    );
    expect(OutlineResultSchema.safeParse({ topics: topics(8) }).success).toBe(
      true
    );
  });

  it("rejects an empty topic list", () => {
    expect(OutlineResultSchema.safeParse({ topics: [] }).success).toBe(false);
  });

  it("rejects more than 8 topics — this is a structural cap, not just prompt guidance", () => {
    expect(OutlineResultSchema.safeParse({ topics: topics(9) }).success).toBe(
      false
    );
  });

  it("rejects a topic missing a description", () => {
    const result = OutlineResultSchema.safeParse({
      topics: [{ topic_id: "t0", title: "Topic 0" }],
    });
    expect(result.success).toBe(false);
  });
});

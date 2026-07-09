import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createArrayItemWatcher,
  createValidatedArrayItemWatcher,
  createStringFieldWatcher,
} from "../src/streaming-json.js";

const claimsFixture = JSON.stringify({
  model_id: "model_a",
  answer_summary: "summary text",
  claims: [
    {
      claim_id: "c0",
      text: 'first claim with "quotes" and a backslash \\',
      type: "fact",
      confidence: 0.9,
      rationale: "because",
      conditions: ["cond1", "cond2"],
    },
    {
      claim_id: "c1",
      text: "second claim",
      type: "opinion",
      confidence: 0.5,
      rationale: "why not",
      conditions: [],
    },
  ],
  assumptions: ["a1"],
  risks: [],
});

function feedInOneShot(fixture: string, targetField: string): string[] {
  const items: string[] = [];
  const watcher = createArrayItemWatcher(targetField, (raw) => items.push(raw));
  watcher.feed(fixture);
  return items;
}

function feedCharByChar(fixture: string, targetField: string): string[] {
  const items: string[] = [];
  const watcher = createArrayItemWatcher(targetField, (raw) => items.push(raw));
  for (const ch of fixture) watcher.feed(ch);
  return items;
}

function feedAtSplitPoints(fixture: string, targetField: string, splits: number[]): string[] {
  const items: string[] = [];
  const watcher = createArrayItemWatcher(targetField, (raw) => items.push(raw));
  let prev = 0;
  for (const split of [...splits, fixture.length]) {
    watcher.feed(fixture.slice(prev, split));
    prev = split;
  }
  return items;
}

describe("createArrayItemWatcher", () => {
  it("extracts both items from a complete array fed in one shot", () => {
    const items = feedInOneShot(claimsFixture, "claims");
    expect(items).toHaveLength(2);
    expect(JSON.parse(items[0]).claim_id).toBe("c0");
    expect(JSON.parse(items[1]).claim_id).toBe("c1");
  });

  it("produces the identical item sequence when fed char-by-char", () => {
    const oneShot = feedInOneShot(claimsFixture, "claims");
    const charByChar = feedCharByChar(claimsFixture, "claims");
    expect(charByChar).toEqual(oneShot);
  });

  it("produces the identical item sequence at several arbitrary split points", () => {
    const oneShot = feedInOneShot(claimsFixture, "claims");
    const splitSets = [
      [10, 50, 120, 200],
      [1, 2, 3, 4, 5, 300],
      [claimsFixture.indexOf('"claims"') + 3],
      [claimsFixture.indexOf("backslash") + 5],
    ];
    for (const splits of splitSets) {
      expect(feedAtSplitPoints(claimsFixture, "claims", splits)).toEqual(oneShot);
    }
  });

  it("handles an escaped backslash split exactly across a feed() boundary", () => {
    // The fixture's first claim text ends in `...backslash \\"` — split right
    // after the lone backslash character so escapeNext state must survive
    // across the chunk boundary without ending the string early.
    const idx = claimsFixture.indexOf("backslash \\") + "backslash \\".length;
    const items = feedAtSplitPoints(claimsFixture, "claims", [idx]);
    expect(items).toHaveLength(2);
    expect(JSON.parse(items[0]).text).toBe('first claim with "quotes" and a backslash \\');
  });

  it("does not treat a nested array's closing bracket as the target array's end", () => {
    // claims[0].conditions is a nested string[] — its own `]` must not be
    // mistaken for the outer claims array's closing bracket.
    const items = feedInOneShot(claimsFixture, "claims");
    expect(items).toHaveLength(2);
    const first = JSON.parse(items[0]);
    expect(first.conditions).toEqual(["cond1", "cond2"]);
  });

  it("is key-position-aware, not a naive substring search for the field name", () => {
    const adversarial = JSON.stringify({
      note: 'this text literally contains "claims": [1,2,3] but is not the field',
      claims: [{ x: 1 }],
    });
    const items = feedInOneShot(adversarial, "claims");
    expect(items).toHaveLength(1);
    expect(JSON.parse(items[0])).toEqual({ x: 1 });
  });

  it("finds the target field regardless of its position among sibling keys", () => {
    const first = JSON.stringify({ claims: [{ n: 1 }], other: "x" });
    const middle = JSON.stringify({ before: "x", claims: [{ n: 1 }], after: "y" });
    const last = JSON.stringify({ other: "x", claims: [{ n: 1 }] });
    for (const fixture of [first, middle, last]) {
      const items = feedInOneShot(fixture, "claims");
      expect(items.map((i) => JSON.parse(i))).toEqual([{ n: 1 }]);
    }
  });

  it("never fires for a field that doesn't exist", () => {
    expect(feedInOneShot(claimsFixture, "nonexistent")).toHaveLength(0);
  });
});

describe("createValidatedArrayItemWatcher", () => {
  const ItemSchema = z.object({ n: z.number() });

  it("only forwards items that pass schema validation", () => {
    const fixture = JSON.stringify({
      items: [{ n: 1 }, { n: "not a number" }, { n: 3 }],
    });
    const valid: unknown[] = [];
    const watcher = createValidatedArrayItemWatcher("items", ItemSchema, (item) =>
      valid.push(item)
    );
    watcher.feed(fixture);
    expect(valid).toEqual([{ n: 1 }, { n: 3 }]);
  });
});

describe("createStringFieldWatcher", () => {
  function relay(fixture: string, targetField: string, splitAt: number[] = []): string {
    let out = "";
    const watcher = createStringFieldWatcher(targetField, (chars) => (out += chars));
    let prev = 0;
    for (const split of [...splitAt, fixture.length]) {
      watcher.feed(fixture.slice(prev, split));
      prev = split;
    }
    return out;
  }

  it("relays a simple string field's characters, in order", () => {
    const fixture = JSON.stringify({ final_answer: "Hello world.", other: "x" });
    expect(relay(fixture, "final_answer")).toBe("Hello world.");
  });

  it("reconstructs the exact string across many arbitrary chunk boundaries", () => {
    const text = 'Line one.\nLine "two" with a backslash \\ and unicode café.';
    const fixture = JSON.stringify({ final_answer: text, strong_consensus: ["a", "b"] });
    for (const splits of [
      [10, 30, 50],
      [1, 2, 3, 4, 5, 6, 7, 8],
      [fixture.indexOf("backslash") + 2],
      [fixture.indexOf("caf") + 3],
    ]) {
      expect(relay(fixture, "final_answer", splits)).toBe(text);
    }
  });

  it("decodes a \\uXXXX escape split across a chunk boundary", () => {
    const fixture = JSON.stringify({ final_answer: "café" });
    const idx = fixture.indexOf("\\u00e9");
    // split in the middle of the é escape sequence
    expect(relay(fixture, "final_answer", [idx + 3])).toBe("café");
  });

  it("stops exactly at the field's closing quote and never leaks a following sibling field", () => {
    const fixture = JSON.stringify({
      final_answer: "the answer",
      strong_consensus: ["should not leak"],
    });
    expect(relay(fixture, "final_answer")).toBe("the answer");
  });

  it("finds the target field regardless of its position among sibling keys", () => {
    const first = JSON.stringify({ final_answer: "x", other: 1 });
    const middle = JSON.stringify({ before: 1, final_answer: "x", after: 2 });
    const last = JSON.stringify({ other: 1, final_answer: "x" });
    for (const fixture of [first, middle, last]) {
      expect(relay(fixture, "final_answer")).toBe("x");
    }
  });

  it("is key-position-aware, not a naive substring search", () => {
    const fixture = JSON.stringify({
      note: '"final_answer": "not this one"',
      final_answer: "the real one",
    });
    expect(relay(fixture, "final_answer")).toBe("the real one");
  });

  it("never fires for a field that doesn't exist", () => {
    const fixture = JSON.stringify({ other: "x" });
    expect(relay(fixture, "final_answer")).toBe("");
  });
});

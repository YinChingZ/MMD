import { describe, expect, it } from "vitest";
import { accumulateComposeText, ROOT_COMPOSE_KEY } from "../src/lib/run-events";

describe("accumulateComposeText — M6.4 compose token streaming", () => {
  it("accumulates deltas under the root key when no topicId is present", () => {
    let text: Record<string, string> = {};
    text = accumulateComposeText(text, { delta: "Hel" });
    text = accumulateComposeText(text, { delta: "lo " });
    text = accumulateComposeText(text, { delta: "world" });
    expect(text[ROOT_COMPOSE_KEY]).toBe("Hello world");
  });

  it("accumulates deltas independently per topicId, never bleeding into another topic or the root", () => {
    let text: Record<string, string> = {};
    text = accumulateComposeText(text, { delta: "root chunk" });
    text = accumulateComposeText(text, { delta: "A1", topicId: "topic_a" });
    text = accumulateComposeText(text, { delta: "B1", topicId: "topic_b" });
    text = accumulateComposeText(text, { delta: "A2", topicId: "topic_a" });

    expect(text[ROOT_COMPOSE_KEY]).toBe("root chunk");
    expect(text.topic_a).toBe("A1A2");
    expect(text.topic_b).toBe("B1");
  });

  it("does not mutate the previous state object (safe for React state updates)", () => {
    const prev = { [ROOT_COMPOSE_KEY]: "existing" };
    const next = accumulateComposeText(prev, { delta: " more" });
    expect(prev[ROOT_COMPOSE_KEY]).toBe("existing");
    expect(next[ROOT_COMPOSE_KEY]).toBe("existing more");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  buildRetrySnapshot,
  consumeRetrySnapshot,
  retryStorageKey,
  saveRetrySnapshot,
} from "../src/lib/retry-snapshot";
import type { ByokEntryUI } from "../src/lib/model-sources";

// Default vitest environment is Node, which has no sessionStorage global —
// this project doesn't otherwise need jsdom/happy-dom, so a minimal in-memory
// polyfill here avoids adding either just for this one test file.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}
(globalThis as { sessionStorage?: Storage }).sessionStorage =
  new MemoryStorage() as unknown as Storage;

const savedKeyEntry: ByokEntryUI = {
  clientId: "a",
  label: "saved-model",
  providerLabel: "OpenAI",
  payload: { savedKeyId: "key-1" },
};

const rawKeyEntry: ByokEntryUI = {
  clientId: "b",
  label: "raw-model",
  providerLabel: "OpenAI",
  payload: { providerId: "openai", modelId: "gpt-4", apiKey: "sk-secret" },
};

describe("buildRetrySnapshot", () => {
  it("keeps savedKeyId-backed byok entries and drops raw-apiKey ones", () => {
    const snapshot = buildRetrySnapshot({
      question: "q",
      mode: "standard",
      governance: "distributed",
      modelIds: ["m1"],
      costLimitUsd: 5,
      outputSchemaText: "",
      webSearch: false,
      byokEntries: [savedKeyEntry, rawKeyEntry],
    });
    expect(snapshot.byokEntries).toEqual([savedKeyEntry]);
    expect(snapshot.droppedByokLabels).toEqual(["raw-model"]);
    expect(snapshot.governance).toBe("distributed");
  });

  it("never includes plaintext apiKey in the snapshot", () => {
    const snapshot = buildRetrySnapshot({
      question: "q",
      mode: "quick",
      governance: "distributed",
      modelIds: [],
      costLimitUsd: 5,
      outputSchemaText: "",
      webSearch: false,
      byokEntries: [rawKeyEntry],
    });
    expect(JSON.stringify(snapshot)).not.toContain("sk-secret");
    expect(snapshot.governance).toBe("centralized");
  });
});

describe("save/consumeRetrySnapshot", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips through sessionStorage and is removed after read", () => {
    const snapshot = buildRetrySnapshot({
      question: "q",
      mode: "standard",
      governance: "centralized",
      modelIds: ["m1"],
      costLimitUsd: 5,
      outputSchemaText: "",
      webSearch: false,
      byokEntries: [savedKeyEntry],
    });
    saveRetrySnapshot("run_1", snapshot);
    expect(sessionStorage.getItem(retryStorageKey("run_1"))).not.toBeNull();

    const restored = consumeRetrySnapshot("run_1");
    expect(restored).toEqual(snapshot);
    expect(sessionStorage.getItem(retryStorageKey("run_1"))).toBeNull();
  });

  it("returns undefined when nothing was saved", () => {
    expect(consumeRetrySnapshot("missing")).toBeUndefined();
  });
});

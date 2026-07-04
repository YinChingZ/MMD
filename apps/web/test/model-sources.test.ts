import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../src/lib/api";
import { mergeModelSources, type ByokEntryUI } from "../src/lib/model-sources";

function legacyModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "model_a",
    providerLabel: "mock",
    isCoordinator: false,
    ...overrides,
  };
}

function byokEntry(overrides: Partial<ByokEntryUI> = {}): ByokEntryUI {
  return {
    clientId: "c1",
    label: "my_openai",
    providerLabel: "OpenAI",
    payload: {
      providerId: "openai",
      modelId: "gpt-4.1-mini",
      apiKey: "sk-test",
    },
    ...overrides,
  };
}

describe("mergeModelSources", () => {
  it("marks legacy rows checked only when their id is in selectedLegacyIds", () => {
    const rows = mergeModelSources(
      [legacyModel({ id: "model_a" }), legacyModel({ id: "model_b" })],
      ["model_a"],
      []
    );
    expect(rows).toEqual([
      {
        key: "legacy:model_a",
        kind: "legacy",
        label: "model_a",
        providerLabel: "mock",
        isCoordinator: false,
        checked: true,
      },
      {
        key: "legacy:model_b",
        kind: "legacy",
        label: "model_b",
        providerLabel: "mock",
        isCoordinator: false,
        checked: false,
      },
    ]);
  });

  it("appends byok entries as always-checked rows after legacy rows", () => {
    const rows = mergeModelSources(
      [legacyModel()],
      ["model_a"],
      [byokEntry()]
    );
    expect(rows).toEqual([
      {
        key: "legacy:model_a",
        kind: "legacy",
        label: "model_a",
        providerLabel: "mock",
        isCoordinator: false,
        checked: true,
      },
      {
        key: "byok:c1",
        kind: "byok",
        label: "my_openai",
        providerLabel: "OpenAI",
        isCoordinator: false,
        checked: true,
      },
    ]);
  });

  it("preserves isCoordinator from the legacy model info", () => {
    const rows = mergeModelSources(
      [legacyModel({ id: "model_a", isCoordinator: true })],
      ["model_a"],
      []
    );
    expect(rows[0].isCoordinator).toBe(true);
  });

  it("returns an empty list when there are no legacy models and no byok entries", () => {
    expect(mergeModelSources([], [], [])).toEqual([]);
  });
});

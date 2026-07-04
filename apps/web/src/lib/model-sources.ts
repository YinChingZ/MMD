import type { ByokModelInput, ModelInfo } from "./api";

// UI-only representation of a BYOK entry the user has added but not yet
// submitted — clientId is a local React key/removal handle, never sent to
// the server; payload is the exact ByokModelInput createRun() will send.
export interface ByokEntryUI {
  clientId: string;
  label: string;
  providerLabel: string;
  payload: ByokModelInput;
}

export interface MergedModelRow {
  key: string;
  kind: "legacy" | "byok";
  label: string;
  providerLabel: string;
  isCoordinator: boolean;
  // Legacy rows are checkboxes (can be unchecked); byok rows are always
  // included once added (removed via the byok list itself, not unchecked).
  checked: boolean;
}

/** Combines server-registry models (checkbox rows) and user-added BYOK entries (always-checked rows) into one list for display. */
export function mergeModelSources(
  legacyModels: ModelInfo[],
  selectedLegacyIds: string[],
  byokEntries: ByokEntryUI[]
): MergedModelRow[] {
  const legacyRows: MergedModelRow[] = legacyModels.map((m) => ({
    key: `legacy:${m.id}`,
    kind: "legacy",
    label: m.id,
    providerLabel: m.providerLabel,
    isCoordinator: m.isCoordinator,
    checked: selectedLegacyIds.includes(m.id),
  }));
  const byokRows: MergedModelRow[] = byokEntries.map((e) => ({
    key: `byok:${e.clientId}`,
    kind: "byok",
    label: e.label,
    providerLabel: e.providerLabel,
    isCoordinator: false,
    checked: true,
  }));
  return [...legacyRows, ...byokRows];
}

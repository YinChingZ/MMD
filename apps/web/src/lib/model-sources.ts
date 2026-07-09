import type { RunMode } from "@mmd/protocol";
import type {
  ByokModelInput,
  InputImageInput,
  ModelInfo,
  OutputFormatInput,
} from "./api";

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

/**
 * Builds createRun()'s request body. modelIds/byokModels must be omitted
 * (not sent as `[]`) when empty — apps/api's Zod schema allows either field
 * to be entirely absent, but rejects an explicitly empty array with
 * "Array must contain at least 1 element(s)". A pure-BYOK submission (no
 * legacy checkboxes selected) was hitting exactly this before, since
 * `modelIds` was always sent as the literal (possibly empty) state array.
 */
export function buildCreateRunPayload(params: {
  question: string;
  mode: RunMode;
  modelIds: string[];
  byokEntries: ByokEntryUI[];
  costLimitUsd: number;
  outputFormat?: OutputFormatInput;
  images?: InputImageInput[];
  webSearch?: boolean;
}): {
  question: string;
  mode: RunMode;
  modelIds?: string[];
  byokModels?: ByokModelInput[];
  costLimitUsd: number;
  outputFormat?: OutputFormatInput;
  images?: InputImageInput[];
  webSearch?: boolean;
} {
  return {
    question: params.question,
    mode: params.mode,
    modelIds: params.modelIds.length ? params.modelIds : undefined,
    byokModels: params.byokEntries.length
      ? params.byokEntries.map((e) => e.payload)
      : undefined,
    costLimitUsd: params.costLimitUsd,
    outputFormat: params.outputFormat,
    images: params.images?.length ? params.images : undefined,
    webSearch: params.webSearch || undefined,
  };
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

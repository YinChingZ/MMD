import type {
  ExperimentManifest,
  Governance,
  RunMode,
} from "@mmd/protocol";

export const PRODUCT_STANDARD_D_EXPERIMENT_ID = "webui-standard-d-v1";
export const PRODUCT_STANDARD_D_ALIGNMENT_VERSION = "complete-link.v1";

/** Quick and Planning are coordinator-locked in mmd.v3. */
export function governanceForMode(
  mode: RunMode,
  governance: Governance,
): Governance {
  return mode === "standard" ? governance : "centralized";
}

/**
 * The public Web UI exposes one safe Standard-D preset, not the research
 * manifest surface. The current API still gates distributed execution behind
 * an ExperimentManifest, so derive that internal envelope at submit time from
 * the final panel size instead of storing research knobs in React state.
 */
export function productExperimentManifest(params: {
  mode: RunMode;
  governance: Governance;
  selectedModelCount: number;
}): ExperimentManifest | undefined {
  if (
    params.mode !== "standard" ||
    governanceForMode(params.mode, params.governance) !== "distributed"
  ) {
    return undefined;
  }

  return {
    experiment_id: PRODUCT_STANDARD_D_EXPERIMENT_ID,
    protocol_version: "mmd.v3",
    alignment_policy: {
      version: PRODUCT_STANDARD_D_ALIGNMENT_VERSION,
      minimum_pair_support: Math.max(
        1,
        Math.ceil((params.selectedModelCount * 2) / 3),
      ),
    },
  };
}

export function governanceLabel(
  mode: RunMode,
  governance: Governance,
): "classic" | "peerGoverned" | undefined {
  if (mode !== "standard") return undefined;
  return governance === "distributed" ? "peerGoverned" : "classic";
}

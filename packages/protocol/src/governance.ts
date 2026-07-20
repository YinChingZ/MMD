import type { RunMode } from "./budget.js";
import type { ExperimentManifest, Governance } from "./schemas/v3.js";

export class ProtocolConfigurationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProtocolConfigurationError";
  }
}

export function resolveGovernance(
  mode: RunMode,
  governance: Governance | undefined,
  experimentManifest?: ExperimentManifest
): Governance {
  const resolved = governance ?? "centralized";
  if ((mode === "quick" || mode === "planning") && resolved !== "centralized") {
    throw new ProtocolConfigurationError(
      "invalid_governance",
      `${mode} only supports centralized governance in mmd.v3`
    );
  }
  if (mode === "standard" && resolved === "distributed") {
    if (!experimentManifest?.alignment_policy) {
      throw new ProtocolConfigurationError(
        "distributed_requires_manifest",
        "distributed Standard requires an mmd.v3 experiment manifest with alignment_policy"
      );
    }
  }
  return resolved;
}

export function assertModelSelection(params: {
  mode: RunMode;
  modelIds: string[];
  coordinatorModelId?: string;
}): void {
  const distinct = new Set(params.modelIds);
  if (distinct.size !== params.modelIds.length) {
    throw new ProtocolConfigurationError(
      "duplicate_models",
      "selected models must be distinct"
    );
  }
  if (params.mode === "quick" && params.modelIds.length !== 2) {
    throw new ProtocolConfigurationError(
      "quick_requires_two_models",
      "quick mode requires exactly two distinct models"
    );
  }
  if (
    params.coordinatorModelId &&
    !distinct.has(params.coordinatorModelId)
  ) {
    throw new ProtocolConfigurationError(
      "coordinator_not_in_panel",
      "coordinatorModelId must be one of the explicitly selected models"
    );
  }
}

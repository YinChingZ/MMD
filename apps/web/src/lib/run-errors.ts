import { ApiError } from "./api";
import { messages } from "./messages";

export function runCreationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "invalid_governance") {
      return messages.errors.invalidGovernance;
    }
    if (error.code === "distributed_requires_manifest") {
      return messages.errors.distributedRequiresManifest;
    }
    if (error.code === "quick_requires_two_models") {
      return messages.errors.quickRequiresExactlyTwoModels;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : messages.errors.generic;
}

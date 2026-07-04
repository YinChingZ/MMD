import type { RunMode } from "@mmd/protocol";
import { phaseListForMode, type FlatProgress } from "@/lib/progress";
import { PhaseStepList } from "./PhaseStepList";

export function PhaseProgress({
  mode,
  progress,
}: {
  mode: RunMode;
  progress: FlatProgress;
}) {
  return (
    <PhaseStepList
      phases={phaseListForMode(mode)}
      statusFor={(phase) => progress.phases[phase] ?? "pending"}
    />
  );
}

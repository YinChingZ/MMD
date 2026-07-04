import type { RunMode } from "@mmd/protocol";
import { estimateDuration } from "@/lib/estimate";

export function TimeEstimateLine({
  mode,
  modelCount,
}: {
  mode: RunMode;
  modelCount: number;
}) {
  if (modelCount === 0) return null;
  return (
    <p className="text-sm text-gray-500">
      Estimated time: {estimateDuration(mode, modelCount)}
    </p>
  );
}

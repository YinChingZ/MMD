import { formatCostLimitLine } from "@/lib/cost";

export function CostEstimateLine({
  costLimitUsd,
  onChange,
}: {
  costLimitUsd: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
      <span>{formatCostLimitLine(costLimitUsd)}</span>
      <label className="flex items-center gap-1">
        <span className="sr-only">Cost limit in USD</span>
        <input
          type="number"
          min={0.01}
          step={0.01}
          value={costLimitUsd}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isFinite(value) && value > 0) onChange(value);
          }}
          className="w-20 rounded border border-gray-300 px-1 py-0.5 text-gray-900"
        />
      </label>
    </div>
  );
}

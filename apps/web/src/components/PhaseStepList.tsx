import type { Phase } from "@mmd/protocol";
import type { PhaseStatus } from "@/lib/progress";

const ICONS: Record<PhaseStatus, string> = {
  pending: "○",
  in_progress: "◐",
  done: "●",
  failed: "✕",
};

const COLORS: Record<PhaseStatus, string> = {
  pending: "text-gray-300",
  in_progress: "text-blue-500",
  done: "text-green-600",
  failed: "text-red-600",
};

export function StatusDot({ status }: { status: PhaseStatus }) {
  return <span className={COLORS[status]}>{ICONS[status]}</span>;
}

export function PhaseStepList({
  phases,
  statusFor,
}: {
  phases: Phase[];
  statusFor: (phase: Phase) => PhaseStatus;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {phases.map((phase, i) => {
        const status = statusFor(phase);
        return (
          <li key={phase} className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <StatusDot status={status} />
              <span className={status === "pending" ? "text-gray-400" : ""}>{phase}</span>
            </span>
            {i < phases.length - 1 && <span className="text-gray-300">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

import type { Phase } from "@mmd/protocol";
import type { PlanningProgress } from "@/lib/progress";
import { PhaseStepList, StatusDot } from "./PhaseStepList";

const TOPIC_PHASES: Phase[] = [
  "propose",
  "critique",
  "revise",
  "normalize",
  "vote",
  "compose",
];

export function PlanningPhaseProgress({ progress }: { progress: PlanningProgress }) {
  const topics = [...progress.topics.entries()];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <StatusDot status={progress.outline} />
        <span className="font-medium">Outline</span>
      </div>

      {topics.length === 0 && (
        <p className="text-sm text-gray-400">Waiting for topics to be outlined…</p>
      )}

      {topics.map(([topicId, topic]) => (
        <div key={topicId} className="rounded border border-gray-200 p-2">
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
            <span>{topic.title ?? topicId}</span>
            {topic.failed && (
              <span className="text-red-600">
                failed{topic.error ? `: ${topic.error}` : ""}
              </span>
            )}
          </div>
          <PhaseStepList
            phases={TOPIC_PHASES}
            statusFor={(phase) => topic.phases[phase] ?? "pending"}
          />
        </div>
      ))}
    </div>
  );
}

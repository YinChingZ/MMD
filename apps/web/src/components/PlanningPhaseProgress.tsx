import type { Phase } from "@mmd/protocol";
import type { PlanningProgress } from "@/lib/progress";
import { PhaseStepList, StatusDot } from "./PhaseStepList";
import { LivePhaseItems } from "./LivePhaseItems";
import { FinalAnswerPanel } from "./FinalAnswerPanel";

const TOPIC_PHASES: Phase[] = [
  "propose",
  "critique",
  "revise",
  "normalize",
  "vote",
  "compose",
];

export function PlanningPhaseProgress({
  progress,
  composeText,
}: {
  progress: PlanningProgress;
  /** M6.4: keyed by topicId — each topic's section-compose streams
   * independently, so multiple topics can be "typing" in parallel. */
  composeText?: Record<string, string>;
}) {
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
            modelProgressFor={(phase) => topic.modelProgress[phase]}
          />
          <div className="mt-2">
            <LivePhaseItems itemProgress={topic.itemProgress} phases={topic.phases} />
          </div>
          {topic.phases.compose === "in_progress" && (
            <div className="mt-2">
              <FinalAnswerPanel
                title="Section answer (typing…)"
                text={composeText?.[topicId] ?? ""}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

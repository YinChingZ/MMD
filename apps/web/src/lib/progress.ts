import type { Phase, RunMode } from "@mmd/protocol";
import type { RunEventMessage } from "./run-events";

export type PhaseStatus = "pending" | "in_progress" | "done" | "failed";

const PHASES_STANDARD: Phase[] = [
  "propose",
  "critique",
  "revise",
  "normalize",
  "vote",
  "compose",
];
const PHASES_QUICK: Phase[] = ["propose", "normalize", "compose"];

export function phaseListForMode(mode: RunMode): Phase[] {
  return mode === "quick" ? PHASES_QUICK : PHASES_STANDARD;
}

export interface FlatProgress {
  kind: "flat";
  phases: Partial<Record<Phase, PhaseStatus>>;
}

export interface TopicProgress {
  title?: string;
  phases: Partial<Record<Phase, PhaseStatus>>;
  failed: boolean;
  error?: string;
}

export interface PlanningProgress {
  kind: "planning";
  outline: PhaseStatus;
  topics: Map<string, TopicProgress>;
}

export type RunProgress = FlatProgress | PlanningProgress;

/**
 * Derives phase-by-phase status from the raw SSE event log. Planning mode's
 * per-topic rows are keyed by the opaque topic_id emitted on every per-topic
 * event; titles are backfilled from the outline step's phase_completed event
 * (data.topics) as soon as it arrives, ahead of GET /result.
 */
export function deriveRunProgress(
  events: RunEventMessage[],
  mode: RunMode
): RunProgress {
  if (mode !== "planning") {
    const phases: Partial<Record<Phase, PhaseStatus>> = {};
    for (const event of events) {
      const phase = event.phase as Phase | null;
      if (!phase) continue;
      if (event.type === "phase_started") phases[phase] = "in_progress";
      else if (event.type === "phase_completed") phases[phase] = "done";
      else if (event.type === "run_failed") phases[phase] = "failed";
    }
    return { kind: "flat", phases };
  }

  let outline: PhaseStatus = "pending";
  const topics = new Map<string, TopicProgress>();
  const getTopic = (topicId: string): TopicProgress => {
    let entry = topics.get(topicId);
    if (!entry) {
      entry = { phases: {}, failed: false };
      topics.set(topicId, entry);
    }
    return entry;
  };

  for (const event of events) {
    const data = (event.data ?? {}) as {
      step?: string;
      error?: string;
      topics?: { topic_id: string; title: string }[];
    };
    if (!event.topicId && data.step === "outline") {
      if (event.type === "phase_started") outline = "in_progress";
      else if (event.type === "phase_completed") {
        outline = "done";
        for (const topic of data.topics ?? []) {
          getTopic(topic.topic_id).title = topic.title;
        }
      }
      continue;
    }
    if (!event.topicId) continue;

    const topic = getTopic(event.topicId);
    if (event.type === "phase_completed" && data.step === "topic") {
      topic.failed = true;
      topic.error = data.error;
      continue;
    }
    const phase = event.phase as Phase | null;
    if (!phase) continue;
    if (event.type === "phase_started") topic.phases[phase] = "in_progress";
    else if (event.type === "phase_completed") topic.phases[phase] = "done";
    else if (event.type === "run_failed") {
      topic.phases[phase] = "failed";
      topic.failed = true;
    }
  }

  return { kind: "planning", outline, topics };
}

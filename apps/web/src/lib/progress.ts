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

export interface PhaseModelProgress {
  responded: { modelId: string; ok: boolean; latencyMs: number }[];
  total: number;
  retrying?: string[];
}

export interface ItemProgressEntry {
  modelId: string;
  arrayField: string;
  items: unknown[];
}

/** Keyed by modelId. */
export type PhaseItemProgress = Record<string, ItemProgressEntry>;

export interface FlatProgress {
  kind: "flat";
  phases: Partial<Record<Phase, PhaseStatus>>;
  modelProgress: Partial<Record<Phase, PhaseModelProgress>>;
  itemProgress: Partial<Record<Phase, PhaseItemProgress>>;
}

export interface TopicProgress {
  title?: string;
  phases: Partial<Record<Phase, PhaseStatus>>;
  modelProgress: Partial<Record<Phase, PhaseModelProgress>>;
  itemProgress: Partial<Record<Phase, PhaseItemProgress>>;
  failed: boolean;
  error?: string;
}

interface ModelRespondedData {
  modelId: string;
  ok: boolean;
  latencyMs: number;
  total: number;
}

function recordModelResponded(
  modelProgress: Partial<Record<Phase, PhaseModelProgress>>,
  phase: Phase,
  data: ModelRespondedData
): void {
  const entry = modelProgress[phase] ?? { responded: [], total: data.total };
  entry.responded = [
    ...entry.responded,
    { modelId: data.modelId, ok: data.ok, latencyMs: data.latencyMs },
  ];
  entry.retrying = entry.retrying?.filter((modelId) => modelId !== data.modelId);
  entry.total = data.total;
  modelProgress[phase] = entry;
}

interface ItemProgressData {
  modelId: string;
  arrayField: string;
  index: number;
  item: unknown;
  attempt: number;
}

interface ModelAttemptData {
  modelId: string;
  attempt: number;
  transport: string;
}

function recordModelAttempt(
  modelProgress: Partial<Record<Phase, PhaseModelProgress>>,
  itemProgress: Partial<Record<Phase, PhaseItemProgress>>,
  phase: Phase,
  data: ModelAttemptData,
): void {
  const entry = modelProgress[phase] ?? { responded: [], total: 0 };
  entry.retrying = [...new Set([...(entry.retrying ?? []), data.modelId])];
  modelProgress[phase] = entry;
  if (itemProgress[phase]) delete itemProgress[phase]![data.modelId];
}

/**
 * index === 0 means a fresh watcher generation started — either a
 * schema-repair retry or a fanOutWithQuorum network retry re-invoked the
 * whole call from scratch (see packages/orchestrator's `attempt` tagging) —
 * so this replaces rather than appends to that model's item list, matching
 * the backend's own "only the last attempt is authoritative" behavior.
 */
function recordItemProgress(
  itemProgress: Partial<Record<Phase, PhaseItemProgress>>,
  phase: Phase,
  data: ItemProgressData
): void {
  const byPhase = itemProgress[phase] ?? {};
  const existing = byPhase[data.modelId];
  byPhase[data.modelId] = {
    modelId: data.modelId,
    arrayField: data.arrayField,
    items: data.index === 0 ? [data.item] : [...(existing?.items ?? []), data.item],
  };
  itemProgress[phase] = byPhase;
}

export interface PlanningProgress {
  kind: "planning";
  outline: PhaseStatus;
  globalCompose: PhaseStatus;
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
    const modelProgress: Partial<Record<Phase, PhaseModelProgress>> = {};
    const itemProgress: Partial<Record<Phase, PhaseItemProgress>> = {};
    for (const event of events) {
      const phase = event.phase as Phase | null;
      if (!phase) continue;
      if (event.type === "phase_started") {
        phases[phase] = "in_progress";
        modelProgress[phase] = { responded: [], total: 0 };
        itemProgress[phase] = {};
      } else if (event.type === "phase_completed") phases[phase] = "done";
      else if (event.type === "run_failed") phases[phase] = "failed";
      else if (event.type === "model_responded") {
        recordModelResponded(modelProgress, phase, event.data as ModelRespondedData);
      } else if (event.type === "model_attempt") {
        recordModelAttempt(modelProgress, itemProgress, phase, event.data as ModelAttemptData);
      } else if (event.type === "item_progress") {
        recordItemProgress(itemProgress, phase, event.data as ItemProgressData);
      }
    }
    return { kind: "flat", phases, modelProgress, itemProgress };
  }

  let outline: PhaseStatus = "pending";
  let globalCompose: PhaseStatus = "pending";
  const topics = new Map<string, TopicProgress>();
  const getTopic = (topicId: string): TopicProgress => {
    let entry = topics.get(topicId);
    if (!entry) {
      entry = { phases: {}, modelProgress: {}, itemProgress: {}, failed: false };
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
    if (!event.topicId && data.step === "global_compose") {
      if (event.type === "phase_started") globalCompose = "in_progress";
      else if (event.type === "phase_completed") globalCompose = "done";
      else if (event.type === "run_failed") globalCompose = "failed";
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
    if (event.type === "phase_started") {
      topic.phases[phase] = "in_progress";
      topic.modelProgress[phase] = { responded: [], total: 0 };
      topic.itemProgress[phase] = {};
    } else if (event.type === "phase_completed") topic.phases[phase] = "done";
    else if (event.type === "run_failed") {
      topic.phases[phase] = "failed";
      topic.failed = true;
    } else if (event.type === "model_responded") {
      recordModelResponded(topic.modelProgress, phase, event.data as ModelRespondedData);
    } else if (event.type === "model_attempt") {
      recordModelAttempt(
        topic.modelProgress,
        topic.itemProgress,
        phase,
        event.data as ModelAttemptData,
      );
    } else if (event.type === "item_progress") {
      recordItemProgress(topic.itemProgress, phase, event.data as ItemProgressData);
    }
  }

  return { kind: "planning", outline, globalCompose, topics };
}

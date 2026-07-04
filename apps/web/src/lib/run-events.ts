// Mirrors apps/api/src/repositories/events-repo.ts's PersistedRunEvent — the
// exact JSON payload written as each SSE frame's `data:` line by
// apps/api/src/sse/broadcaster.ts's writeSseEvent(). `topicId` is already
// lifted out of `data.topicId` server-side (extractTopicId), so planning
// mode's per-topic events can be routed without re-parsing `data` here.
export interface RunEventMessage {
  seq: number;
  type: string;
  phase: string | null;
  topicId: string | null;
  data: unknown;
  createdAt: string;
}

// The Fastify route sets `event: <type>` explicitly per frame (see
// events.ts/broadcaster.ts), so EventSource's generic `onmessage` (which only
// fires for unnamed "message" events) never fires — every known type needs
// its own addEventListener.
export const SSE_EVENT_TYPES = [
  "run_started",
  "phase_started",
  "phase_completed",
  "run_failed",
  "run_completed",
] as const;

export const TERMINAL_EVENT_TYPES = new Set(["run_completed", "run_failed"]);

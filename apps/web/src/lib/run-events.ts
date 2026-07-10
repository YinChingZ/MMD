// Mirrors apps/api/src/repositories/events-repo.ts's PersistedRunEvent — the
// exact JSON payload written as each SSE frame's `data:` line by
// apps/api/src/sse/broadcaster.ts's writeSseEvent(). `topicId` is already
// lifted out of `data.topicId` server-side (extractTopicId), so planning
// mode's per-topic events can be routed without re-parsing `data` here.
// `seq` is null for M6.4's ephemeral `token` events (see
// apps/api/src/sse/broadcaster.ts's EphemeralRunEvent/writeSseEventEphemeral)
// — those are never DB-persisted and never replayable on reconnect.
export interface RunEventMessage {
  seq: number | null;
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
  "model_attempt",
  "model_responded",
  "item_progress",
  "phase_completed",
  "run_failed",
  "run_completed",
] as const;

/** M6.4: handled separately from SSE_EVENT_TYPES by useRunEvents — token
 * deltas never enter the main `events` array (would grow unboundedly for a
 * long compose stream), they're accumulated into a dedicated `composeText`
 * map instead. */
export const TOKEN_EVENT_TYPE = "token";

/** composeText is keyed by topicId, or "_root" for standard/quick mode's
 * single compose call — each key accumulates that stream's deltas
 * independently, so planning mode's parallel per-topic section-compose
 * streams never bleed into each other. */
export const ROOT_COMPOSE_KEY = "_root";

export interface TokenData {
  delta: string;
  topicId?: string;
}

/** Pure reducer extracted out of useRunEvents so the accumulation logic is
 * unit-testable without a DOM/EventSource environment. */
export function accumulateComposeText(
  prev: Record<string, string>,
  data: TokenData
): Record<string, string> {
  const key = data.topicId ?? ROOT_COMPOSE_KEY;
  return { ...prev, [key]: (prev[key] ?? "") + data.delta };
}

export const TERMINAL_EVENT_TYPES = new Set(["run_completed", "run_failed"]);

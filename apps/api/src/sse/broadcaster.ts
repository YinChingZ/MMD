import type { ServerResponse } from "node:http";
import type { PersistedRunEvent } from "../repositories/events-repo.js";

const TERMINAL_EVENT_TYPES = new Set(["run_completed", "run_failed"]);

export function writeSseEvent(
  res: ServerResponse,
  event: PersistedRunEvent
): void {
  res.write(`id: ${event.seq}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * In-memory pub/sub fanning out live run events to connected SSE clients.
 * Single Node process is sufficient for M2 (no Redis) — see the M2 plan's
 * "no Redis" deviation note. Durability for replay-on-reconnect comes from
 * `run_events` in Postgres, not from this class.
 */
export class RunBroadcaster {
  private subscribers = new Map<string, Set<ServerResponse>>();

  subscribe(runId: string, res: ServerResponse): () => void {
    let set = this.subscribers.get(runId);
    if (!set) {
      set = new Set();
      this.subscribers.set(runId, set);
    }
    set.add(res);
    return () => {
      set?.delete(res);
      if (set && set.size === 0) this.subscribers.delete(runId);
    };
  }

  publish(runId: string, event: PersistedRunEvent): void {
    const set = this.subscribers.get(runId);
    if (!set) return;
    for (const res of set) {
      writeSseEvent(res, event);
      if (TERMINAL_EVENT_TYPES.has(event.type)) res.end();
    }
    if (TERMINAL_EVENT_TYPES.has(event.type)) this.subscribers.delete(runId);
  }
}

"use client";

import { useEffect, useState } from "react";
import {
  SSE_EVENT_TYPES,
  TERMINAL_EVENT_TYPES,
  type RunEventMessage,
} from "@/lib/run-events";

export function useRunEvents(runId: string, active: boolean) {
  const [events, setEvents] = useState<RunEventMessage[]>([]);

  useEffect(() => {
    if (!active) return;
    setEvents([]);
    const source = new EventSource(`/api/runs/${runId}/events`);

    const handleMessage = (e: MessageEvent<string>) => {
      const parsed = JSON.parse(e.data) as RunEventMessage;
      setEvents((prev) => [...prev, parsed]);
      if (TERMINAL_EVENT_TYPES.has(parsed.type)) source.close();
    };

    for (const type of SSE_EVENT_TYPES) {
      source.addEventListener(type, handleMessage);
    }

    return () => source.close();
  }, [runId, active]);

  return events;
}

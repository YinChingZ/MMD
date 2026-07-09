"use client";

import { useEffect, useState } from "react";
import {
  accumulateComposeText,
  SSE_EVENT_TYPES,
  TERMINAL_EVENT_TYPES,
  TOKEN_EVENT_TYPE,
  type RunEventMessage,
  type TokenData,
} from "@/lib/run-events";

export function useRunEvents(runId: string, active: boolean) {
  const [events, setEvents] = useState<RunEventMessage[]>([]);
  const [composeText, setComposeText] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!active) return;
    setEvents([]);
    setComposeText({});
    const source = new EventSource(`/api/runs/${runId}/events`);

    const handleMessage = (e: MessageEvent<string>) => {
      const parsed = JSON.parse(e.data) as RunEventMessage;
      setEvents((prev) => [...prev, parsed]);
      if (TERMINAL_EVENT_TYPES.has(parsed.type)) source.close();
    };
    const handleToken = (e: MessageEvent<string>) => {
      const parsed = JSON.parse(e.data) as RunEventMessage;
      setComposeText((prev) => accumulateComposeText(prev, parsed.data as TokenData));
    };

    for (const type of SSE_EVENT_TYPES) {
      source.addEventListener(type, handleMessage);
    }
    source.addEventListener(TOKEN_EVENT_TYPE, handleToken);

    return () => source.close();
  }, [runId, active]);

  return { events, composeText };
}

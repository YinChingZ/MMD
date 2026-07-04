"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getConversation, type ConversationSummary, type RunRow } from "@/lib/api";
import { QuestionForm } from "@/components/QuestionForm";
import { RunStatusBadge } from "@/components/RunStatusBadge";

export function ConversationPageClient({ conversationId }: { conversationId: string }) {
  const [conversation, setConversation] = useState<
    (ConversationSummary & { runs: RunRow[] }) | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    getConversation(conversationId).then((c) => {
      if (!cancelled) setConversation(c);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-lg font-semibold">
        {conversation?.title || "Untitled conversation"}
      </h1>

      <QuestionForm conversationId={conversationId} />

      {conversation && conversation.runs.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-gray-700">Past runs</h2>
          <ul className="flex flex-col gap-1">
            {conversation.runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/conversations/${conversationId}/runs/${run.id}`}
                  className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <span className="truncate">{run.question}</span>
                  <RunStatusBadge status={run.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

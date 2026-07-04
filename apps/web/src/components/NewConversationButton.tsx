"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createConversation, type ConversationSummary } from "@/lib/api";

export function NewConversationButton({
  onCreated,
}: {
  onCreated: (conversation: ConversationSummary) => void;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      const conversation = await createConversation();
      onCreated(conversation);
      router.push(`/conversations/${conversation.id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <button
      type="button"
      onClick={create}
      disabled={creating}
      className="w-full rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
    >
      {creating ? "Creating…" : "+ New conversation"}
    </button>
  );
}

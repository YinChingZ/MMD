"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { listConversations, type ConversationSummary } from "@/lib/api";
import { NewConversationButton } from "./NewConversationButton";

export function ConversationSidebar() {
  const pathname = usePathname();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    listConversations().then((list) => {
      setConversations(list);
      setLoaded(true);
    });
  }, []);

  const list = (
    <>
      <NewConversationButton
        onCreated={(c) => setConversations((prev) => [c, ...prev])}
      />
      <nav className="mt-4 flex flex-col gap-1 overflow-y-auto">
        {loaded && conversations.length === 0 && (
          <p className="text-sm text-gray-400">No conversations yet.</p>
        )}
        {conversations.map((c) => {
          const href = `/conversations/${c.id}`;
          const active = pathname?.startsWith(href) ?? false;
          return (
            <Link
              key={c.id}
              href={href}
              onClick={() => setOpen(false)}
              className={`truncate rounded px-2 py-1.5 text-sm ${
                active ? "bg-gray-200 font-medium" : "hover:bg-gray-100"
              }`}
            >
              {c.title || "Untitled conversation"}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      <div className="flex items-center justify-between border-b border-gray-200 p-3 md:hidden">
        <span className="font-semibold">MMD</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          {open ? "Close" : "Conversations"}
        </button>
      </div>
      {open && <div className="border-b border-gray-200 p-3 md:hidden">{list}</div>}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-gray-200 p-3 md:flex">
        {list}
      </aside>
    </>
  );
}

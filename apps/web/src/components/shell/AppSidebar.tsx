"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  createConversation,
  deleteConversation,
  listConversations,
  renameConversation,
  type ConversationSummary,
} from "../../lib/api";
import { dateGroupKey, type DateGroupKey } from "../../lib/format";
import { messages } from "../../lib/messages";
import {
  notifyConversationsChanged,
  onConversationsChanged,
} from "../../lib/workspace-events";
import { BrandMark } from "../BrandMark";
import { Skeleton } from "../ui/skeleton";
import { SidebarItem } from "./SidebarItem";

const GROUP_ORDER: DateGroupKey[] = ["today", "yesterday", "week", "earlier"];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    listConversations()
      .then((list) => {
        setConversations(list);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
    return onConversationsChanged(refresh);
  }, [refresh]);

  const createNew = async () => {
    setCreating(true);
    try {
      const conversation = await createConversation();
      notifyConversationsChanged();
      router.push(`/conversations/${conversation.id}`);
    } catch {
      toast.error(messages.errors.generic);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      toast.success(messages.shell.deleteSuccess);
      if (pathname?.startsWith(`/conversations/${id}`)) {
        router.push("/");
      }
    } catch {
      toast.error(messages.shell.deleteFailed);
    }
  };

  const handleRename = async (id: string, title: string) => {
    try {
      const updated = await renameConversation(id, title);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? updated : c)),
      );
      notifyConversationsChanged();
      toast.success(messages.shell.renameSuccess);
    } catch {
      toast.error(messages.shell.renameFailed);
    }
  };

  const groups = useMemo(() => {
    const sorted = [...conversations].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const map = new Map<DateGroupKey, ConversationSummary[]>();
    for (const c of sorted) {
      const key = dateGroupKey(c.updatedAt);
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return GROUP_ORDER.filter((k) => map.has(k)).map((k) => ({
      key: k,
      items: map.get(k)!,
    }));
  }, [conversations]);

  return (
    <aside className="hidden w-[272px] shrink-0 flex-col border-r border-border bg-surface md:flex">
      {/* 品牌行 */}
      <Link
        href="/"
        className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4"
      >
        <BrandMark className="h-6 w-6" />
        <span className="text-[15px] font-semibold tracking-tight text-ink">
          {messages.common.appName}
        </span>
        <span className="text-xs text-ink-faint">
          {messages.common.appTagline}
        </span>
      </Link>

      <div className="p-3">
        <button
          type="button"
          onClick={createNew}
          disabled={creating}
          className="flex w-full items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground shadow-card transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {messages.shell.newDecision}
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {!loaded && (
          <div className="flex flex-col gap-2 px-1 pt-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        )}
        {loaded && conversations.length === 0 && (
          <p className="px-2 pt-2 text-sm text-ink-faint">
            {messages.shell.empty}
          </p>
        )}
        {groups.map((group) => (
          <div key={group.key} className="mt-3 first:mt-1">
            <h2 className="px-2 pb-1 text-xs font-medium text-ink-faint">
              {messages.shell.dateGroups[group.key]}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((c) => (
                <SidebarItem
                  key={c.id}
                  conversation={c}
                  active={pathname?.startsWith(`/conversations/${c.id}`) ?? false}
                  onDelete={() => handleDelete(c.id)}
                  onRename={(title) => handleRename(c.id, title)}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

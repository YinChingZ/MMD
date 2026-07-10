"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { ConversationSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { messages } from "../../lib/messages";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent } from "../ui/dialog";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export function SidebarItem({
  conversation,
  active,
  onDelete,
  onRename,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(conversation.title ?? "");

  const submitRename = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = titleDraft.trim();
    if (!trimmed) return;
    setRenameOpen(false);
    onRename(trimmed);
  };

  return (
    <li className="group relative">
      <Link
        href={`/conversations/${conversation.id}`}
        className={cn(
          "block truncate rounded-sm px-2 py-1.5 pr-8 text-sm transition-colors",
          active
            ? "bg-accent-muted font-medium text-ink"
            : "text-ink-muted hover:bg-surface-hover hover:text-ink",
        )}
      >
        {conversation.title || messages.shell.untitled}
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={messages.shell.conversationMenu}
            className={cn(
              "absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-1 text-ink-faint",
              "opacity-0 transition-opacity hover:bg-surface-hover hover:text-ink",
              "focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring",
              "group-hover:opacity-100 data-[state=open]:opacity-100",
            )}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={() => {
              setTitleDraft(conversation.title ?? "");
              setRenameOpen(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            {messages.common.rename}
          </DropdownMenuItem>
          <DropdownMenuItem tone="danger" onSelect={() => setConfirmOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            {messages.common.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent title={messages.shell.renameConversationTitle}>
          <form onSubmit={submitRename}>
            <Input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder={messages.shell.renamePlaceholder}
              maxLength={200}
              className="mt-3"
            />
            <div className="mt-4 flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="secondary" size="sm">
                  {messages.common.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={!titleDraft.trim()}>
                {messages.common.save}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          title={messages.shell.deleteConversationTitle}
          description={messages.shell.deleteConversationBody}
        >
          <p className="mt-3 truncate rounded-sm bg-surface-muted px-3 py-2 text-sm text-ink">
            {conversation.title || messages.shell.untitled}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary" size="sm">
                {messages.common.cancel}
              </Button>
            </DialogClose>
            <Button
              size="sm"
              className="bg-danger text-accent-foreground hover:bg-danger"
              onClick={() => {
                setConfirmOpen(false);
                onDelete();
              }}
            >
              {messages.common.delete}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}

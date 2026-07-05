import type { ReactNode } from "react";
import { ConversationSidebar } from "@/components/ConversationSidebar";

/**
 * The app-chrome layout (sidebar + conversation list) for every page except
 * the public /share/[token] one — M5.5 needs a share link a random visitor
 * can open with no workspace-identity actions (like "+ New conversation")
 * anywhere on the page, so that page sits outside this route group and only
 * gets the bare root layout instead.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <ConversationSidebar />
      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}

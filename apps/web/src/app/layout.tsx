import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "MMD — 多模型协商决策",
    template: "%s · MMD",
  },
  description:
    "让多个大模型独立判断、相互质疑并投票，产出标注共识强度、可追溯来源的决策答案。",
};

// Deliberately bare — the sidebar/conversation-list chrome lives in
// app/(app)/layout.tsx instead, so the public app/share/[token] page (M5.5,
// outside that route group) never renders any workspace-identity actions
// like "+ New conversation" for an anonymous visitor.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MMD — Multi-Model Deliberation",
  description: "Multiple LLMs propose, critique, revise, and vote toward a transparent consensus answer.",
};

// Deliberately bare — the sidebar/conversation-list chrome lives in
// app/(app)/layout.tsx instead, so the public app/share/[token] page (M5.5,
// outside that route group) never renders any workspace-identity actions
// like "+ New conversation" for an anonymous visitor.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="text-gray-900">{children}</body>
    </html>
  );
}

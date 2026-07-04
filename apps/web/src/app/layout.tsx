import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "MMD — Multi-Model Deliberation",
  description: "Multiple LLMs propose, critique, revise, and vote toward a transparent consensus answer.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col text-gray-900 md:flex-row">
        <ConversationSidebar />
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </body>
    </html>
  );
}

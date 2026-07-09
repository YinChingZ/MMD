import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";

/**
 * The app-chrome layout (three-column workspace shell) for every page except
 * the public /share/[token] one — that page sits outside this route group and
 * only gets the bare root layout, so an anonymous visitor never sees any
 * workspace-identity actions.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}

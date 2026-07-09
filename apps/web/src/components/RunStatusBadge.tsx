import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { RunStatus } from "@/lib/api";
import { messages } from "@/lib/messages";
import { Badge } from "./ui/badge";

export function RunStatusBadge({ status }: { status: RunStatus }) {
  if (status === "running") {
    return (
      <Badge tone="accent">
        <Loader2 className="h-3 w-3 animate-spin" />
        {messages.run.statusRunning}
      </Badge>
    );
  }
  if (status === "completed") {
    return (
      <Badge tone="strong">
        <CheckCircle2 className="h-3 w-3" />
        {messages.run.statusCompleted}
      </Badge>
    );
  }
  return (
    <Badge tone="rejected">
      <XCircle className="h-3 w-3" />
      {messages.run.statusFailed}
    </Badge>
  );
}

import type { Governance, RunMode } from "@mmd/protocol";
import { messages } from "@/lib/messages";
import { Badge } from "../ui/badge";

export function GovernanceBadge({
  mode,
  governance,
}: {
  mode: RunMode;
  governance: Governance;
}) {
  if (mode !== "standard") return null;
  return (
    <Badge tone={governance === "distributed" ? "qualified" : "neutral"}>
      {messages.governance[governance].shortName}
      {governance === "distributed"
        ? ` · ${messages.governance.experimental}`
        : ""}
    </Badge>
  );
}

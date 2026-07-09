import type { Revision } from "@mmd/protocol";

export function RevisionPreview({ revision }: { revision: Revision }) {
  return (
    <li>
      {revision.decision} {revision.original_claim_id}
      {revision.revised_text ? `: "${revision.revised_text}"` : ""} —{" "}
      {revision.reason_for_change}
    </li>
  );
}

import type { Ballot } from "@mmd/protocol";

export function BallotPreview({ ballot }: { ballot: Ballot }) {
  return (
    <li>
      {ballot.vote} on {ballot.candidate_id}
      {ballot.objection_severity ? ` (${ballot.objection_severity})` : ""}: {ballot.reason}
    </li>
  );
}

import type { Claim } from "@mmd/protocol";

export function ProposalClaimPreview({ claim }: { claim: Claim }) {
  return (
    <li>
      {claim.text}{" "}
      <span className="text-gray-400">
        ({claim.type}, confidence {claim.confidence})
      </span>
    </li>
  );
}

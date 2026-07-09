import type { Review } from "@mmd/protocol";

export function ReviewPreview({ review }: { review: Review }) {
  return (
    <li>
      {review.stance}/{review.severity} on {review.target_claim_id}: {review.comment}
    </li>
  );
}

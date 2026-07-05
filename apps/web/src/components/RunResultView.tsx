import type { RunResult } from "@/lib/api";
import { formatRunCost } from "@/lib/cost";
import { ConsensusPanel } from "./ConsensusPanel";
import { DiscussionProcess } from "./DiscussionProcess";
import { FinalAnswerPanel } from "./FinalAnswerPanel";
import { PlanDocumentView } from "./PlanDocumentView";

/**
 * The read-only "completed run" view — shared between the authenticated
 * RunPageClient and the public, cookie-free SharePageClient (M5.5). Nothing
 * here depends on workspace state; it only ever reads from the RunResult
 * passed in, so it's safe to render from either an owner's fetch or an
 * anonymous share-token fetch.
 */
export function RunResultView({ result }: { result: RunResult }) {
  return (
    <>
      {result.cost && (
        <p className="text-sm text-gray-500">{formatRunCost(result.cost)}</p>
      )}
      {result.planDocument ? (
        <PlanDocumentView planDocument={result.planDocument} topics={result.topics ?? []} />
      ) : (
        <>
          <FinalAnswerPanel text={result.final.final_answer} />
          <ConsensusPanel
            candidates={result.normalize.candidate_claims}
            classifications={result.classifications}
            proposals={result.proposals}
            revisions={result.revisions}
          />
          <DiscussionProcess
            proposals={result.proposals}
            critiques={result.critiques}
            revisions={result.revisions}
            votes={result.votes}
          />
        </>
      )}
    </>
  );
}

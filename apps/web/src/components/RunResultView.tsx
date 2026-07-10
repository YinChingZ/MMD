"use client";

import { ClipboardList } from "lucide-react";
import { toast } from "sonner";
import type { RunResult } from "@/lib/api";
import { messages } from "@/lib/messages";
import { buildTranscript } from "@/lib/transcript";
import { Button } from "./ui/button";
import { ConsensusSection } from "./results/ConsensusSection";
import { DeliberationRecord } from "./results/DeliberationRecord";
import { FinalAnswerCard } from "./results/FinalAnswerCard";
import { StructuredOutputPanel } from "./results/StructuredOutputPanel";
import { PlanDocumentView } from "./PlanDocumentView";

/**
 * The read-only "completed run" view — shared between the authenticated
 * RunPageClient and the public, cookie-free SharePageClient (M5.5). Nothing
 * here depends on workspace state; it only ever reads from the RunResult
 * passed in, so it's safe to render from either an owner's fetch or an
 * anonymous share-token fetch.
 *
 * 布局原则：答案优先，证据按需展开——首屏最终答案卡，其后共识分区、
 * 审议过程（默认收起）、结构化输出。
 */
export function RunResultView({ result }: { result: RunResult }) {
  const copyTranscript = async () => {
    await navigator.clipboard.writeText(buildTranscript(result));
    toast.success(messages.results.transcriptCopied);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={copyTranscript}>
          <ClipboardList className="h-3.5 w-3.5" />
          {messages.results.copyTranscript}
        </Button>
      </div>

      {result.planDocument ? (
        <PlanDocumentView
          planDocument={result.planDocument}
          topics={result.topics ?? []}
        />
      ) : (
        <>
          <FinalAnswerCard text={result.final.final_answer} result={result} />
          <ConsensusSection
            candidates={result.normalize.candidate_claims}
            classifications={result.classifications}
            proposals={result.proposals}
            revisions={result.revisions}
          />
          <DeliberationRecord
            proposals={result.proposals}
            critiques={result.critiques}
            revisions={result.revisions}
            votes={result.votes}
          />
        </>
      )}

      {result.userOutput !== undefined && (
        <StructuredOutputPanel userOutput={result.userOutput} />
      )}
      {result.userOutputError && (
        <p className="text-sm text-consensus-disputed">
          {messages.jsonOutput.resultError}（{result.userOutputError}）——
          上方主结果不受影响。
        </p>
      )}
    </div>
  );
}

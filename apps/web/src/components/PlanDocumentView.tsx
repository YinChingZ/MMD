"use client";

import { useState } from "react";
import type { PlanDocument, SectionAnswer } from "@mmd/protocol";
import type { TopicResult } from "@mmd/orchestrator";
import { ConsensusPanel } from "./ConsensusPanel";
import { DiscussionProcess } from "./DiscussionProcess";
import { FinalAnswerPanel } from "./FinalAnswerPanel";
import { Markdown } from "./Markdown";

function SectionAccordionItem({
  section,
  topicResult,
}: {
  section: SectionAnswer;
  topicResult?: TopicResult;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-3 text-left"
      >
        <span className="font-medium">{section.title}</span>
        <span className="text-xs text-gray-400">{open ? "collapse" : "expand"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-gray-100 p-3">
          <FinalAnswerPanel title={section.title} text={section.section_answer} />
          {topicResult && (
            <>
              <ConsensusPanel
                candidates={topicResult.normalize.candidate_claims}
                classifications={topicResult.classifications}
                proposals={topicResult.proposals}
                revisions={topicResult.revisions}
              />
              <DiscussionProcess
                proposals={topicResult.proposals}
                critiques={topicResult.critiques}
                revisions={topicResult.revisions}
                votes={topicResult.votes}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PlanDocumentView({
  planDocument,
  topics,
}: {
  planDocument: PlanDocument;
  topics: TopicResult[];
}) {
  const topicById = new Map(topics.map((t) => [t.topic.topic_id, t]));
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-gray-200 p-4">
        <h2 className="mb-2 text-lg font-semibold">Executive summary</h2>
        <Markdown text={planDocument.executive_summary} />
      </div>
      {planDocument.sections.map((section) => (
        <SectionAccordionItem
          key={section.topic_id}
          section={section}
          topicResult={topicById.get(section.topic_id)}
        />
      ))}
    </div>
  );
}

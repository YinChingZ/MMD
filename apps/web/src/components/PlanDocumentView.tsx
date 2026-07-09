"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PlanDocument, SectionAnswer } from "@mmd/protocol";
import type { TopicResult } from "@mmd/orchestrator";
import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import { ConsensusSection } from "./results/ConsensusSection";
import { DeliberationRecord } from "./results/DeliberationRecord";
import { Markdown } from "./Markdown";

function sectionAnchor(topicId: string) {
  return `section-${topicId}`;
}

function SectionItem({
  section,
  topicResult,
}: {
  section: SectionAnswer;
  topicResult?: TopicResult;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section
      id={sectionAnchor(section.topic_id)}
      className="scroll-mt-4 rounded-lg border border-border bg-surface shadow-card"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
      >
        <span className="text-base font-semibold text-ink">{section.title}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-ink-faint transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="mmd-enter flex flex-col gap-4 border-t border-border p-4">
          <div className="leading-relaxed">
            <Markdown text={section.section_answer} />
          </div>
          {topicResult && (
            <>
              <ConsensusSection
                candidates={topicResult.normalize.candidate_claims}
                classifications={topicResult.classifications}
                proposals={topicResult.proposals}
                revisions={topicResult.revisions}
                idPrefix={`consensus-${section.topic_id}`}
              />
              <DeliberationRecord
                proposals={topicResult.proposals}
                critiques={topicResult.critiques}
                revisions={topicResult.revisions}
                votes={topicResult.votes}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** 规划模式结果：目录 + 执行摘要 + 分节文档（每节含局部共识与证据）。 */
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
      {/* 目录 */}
      {planDocument.sections.length > 1 && (
        <nav
          aria-label={messages.results.tableOfContents}
          className="rounded-lg border border-border bg-surface p-4 shadow-card"
        >
          <h2 className="text-xs font-semibold text-ink-faint">
            {messages.results.tableOfContents}
          </h2>
          <ol className="mt-2 flex flex-col gap-1">
            {planDocument.sections.map((section, i) => (
              <li key={section.topic_id}>
                <a
                  href={`#${sectionAnchor(section.topic_id)}`}
                  className="text-sm text-ink-muted transition-colors hover:text-accent"
                >
                  {i + 1}. {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {/* 执行摘要 */}
      <section className="rounded-lg border border-border bg-surface p-6 shadow-card">
        <h2 className="text-lg font-semibold text-ink">
          {messages.results.executiveSummary}
        </h2>
        <div className="mt-3 leading-relaxed">
          <Markdown text={planDocument.executive_summary} />
        </div>
      </section>

      {planDocument.sections.map((section) => (
        <SectionItem
          key={section.topic_id}
          section={section}
          topicResult={topicById.get(section.topic_id)}
        />
      ))}
    </div>
  );
}

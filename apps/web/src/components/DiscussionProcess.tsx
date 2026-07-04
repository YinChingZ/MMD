"use client";

import { useState, type ReactNode } from "react";
import type { Critique, Proposal, RevisionSet, VoteSet } from "@mmd/protocol";

function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-gray-100 py-2 first:border-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-sm font-medium">
        {open ? "▾" : "▸"} {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function DiscussionProcess({
  proposals,
  critiques,
  revisions,
  votes,
}: {
  proposals: Proposal[];
  critiques: Critique[];
  revisions: RevisionSet[];
  votes: VoteSet[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-gray-200 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-semibold"
      >
        {open ? "▾" : "▸"} Discussion process
      </button>
      {open && (
        <div className="mt-2 flex flex-col">
          <Collapsible title={`Proposals (${proposals.length})`}>
            {proposals.map((p) => (
              <div key={p.model_id} className="mb-2 text-xs">
                <p className="font-medium">{p.model_id}</p>
                <p className="text-gray-600">{p.answer_summary}</p>
                <ul className="ml-3 list-disc text-gray-500">
                  {p.claims.map((c) => (
                    <li key={c.claim_id}>
                      {c.text}{" "}
                      <span className="text-gray-400">
                        ({c.type}, confidence {c.confidence})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Collapsible>

          <Collapsible title={`Critiques (${critiques.length})`}>
            {critiques.map((c) => (
              <div key={c.reviewer_model_id} className="mb-2 text-xs">
                <p className="font-medium">{c.reviewer_model_id}</p>
                <ul className="ml-3 list-disc text-gray-500">
                  {c.reviews.map((r, i) => (
                    <li key={i}>
                      {r.stance}/{r.severity} on {r.target_claim_id}: {r.comment}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Collapsible>

          <Collapsible title={`Revisions (${revisions.length})`}>
            {revisions.map((r) => (
              <div key={r.model_id} className="mb-2 text-xs">
                <p className="font-medium">{r.model_id}</p>
                <ul className="ml-3 list-disc text-gray-500">
                  {r.revisions.map((rev, i) => (
                    <li key={i}>
                      {rev.decision} {rev.original_claim_id}
                      {rev.revised_text ? `: "${rev.revised_text}"` : ""} — {rev.reason_for_change}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Collapsible>

          <Collapsible title={`Votes (${votes.length})`}>
            {votes.map((v) => (
              <div key={v.model_id} className="mb-2 text-xs">
                <p className="font-medium">{v.model_id}</p>
                <ul className="ml-3 list-disc text-gray-500">
                  {v.votes.map((b, i) => (
                    <li key={i}>
                      {b.vote} on {b.candidate_id}
                      {b.objection_severity ? ` (${b.objection_severity})` : ""}: {b.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Collapsible>
        </div>
      )}
    </div>
  );
}

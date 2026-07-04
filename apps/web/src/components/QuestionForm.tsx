"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RunMode } from "@mmd/protocol";
import { createRun } from "@/lib/api";
import { ModeSelector } from "./ModeSelector";
import { ModelMultiSelect } from "./ModelMultiSelect";
import { TimeEstimateLine } from "./TimeEstimateLine";

export function QuestionForm({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<RunMode>("standard");
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!question.trim() || modelIds.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const { runId } = await createRun(conversationId, {
        question: question.trim(),
        mode,
        modelIds,
      });
      router.push(`/conversations/${conversationId}/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <textarea
        className="min-h-24 rounded border border-gray-300 p-2"
        placeholder="Ask a question for the models to deliberate on…"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />

      <div>
        <h3 className="mb-1 text-sm font-medium text-gray-700">Mode</h3>
        <ModeSelector value={mode} onChange={setMode} />
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium text-gray-700">Models</h3>
        <ModelMultiSelect selected={modelIds} onChange={setModelIds} />
      </div>

      <TimeEstimateLine mode={mode} modelCount={modelIds.length} />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={submitting || !question.trim() || modelIds.length === 0}
        onClick={submit}
        className="self-start rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {submitting ? "Starting…" : "Start deliberation"}
      </button>
    </div>
  );
}

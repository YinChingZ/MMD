"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RunMode } from "@mmd/protocol";
import { createRun } from "@/lib/api";
import type { ByokEntryUI } from "@/lib/model-sources";
import { ByokModelForm } from "./ByokModelForm";
import { CostEstimateLine } from "./CostEstimateLine";
import { ModeSelector } from "./ModeSelector";
import { ModelMultiSelect } from "./ModelMultiSelect";
import { SavedKeysPicker } from "./SavedKeysPicker";
import { TimeEstimateLine } from "./TimeEstimateLine";

// Mirrors apps/api/src/routes/runs.ts's DEFAULT_COST_LIMIT_USD — kept as an
// independent constant since the two apps don't share a config package for
// a single number, not because the value is meant to drift between them.
const DEFAULT_COST_LIMIT_USD = 5;

export function QuestionForm({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<RunMode>("standard");
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [byokEntries, setByokEntries] = useState<ByokEntryUI[]>([]);
  const [costLimitUsd, setCostLimitUsd] = useState(DEFAULT_COST_LIMIT_USD);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAnyModel = modelIds.length > 0 || byokEntries.length > 0;

  const addByokEntry = (entry: ByokEntryUI) =>
    setByokEntries((prev) => [...prev, entry]);
  const removeByokEntry = (clientId: string) =>
    setByokEntries((prev) => prev.filter((e) => e.clientId !== clientId));

  const submit = async () => {
    if (!question.trim() || !hasAnyModel) return;
    setSubmitting(true);
    setError(null);
    try {
      const { runId } = await createRun(conversationId, {
        question: question.trim(),
        mode,
        modelIds,
        byokModels: byokEntries.length
          ? byokEntries.map((e) => e.payload)
          : undefined,
        costLimitUsd,
      });
      router.push(`/conversations/${conversationId}/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const addedSavedKeyIds = byokEntries
    .map((e) => ("savedKeyId" in e.payload ? e.payload.savedKeyId : undefined))
    .filter((id): id is string => Boolean(id));

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
        <ModelMultiSelect
          selected={modelIds}
          onChange={setModelIds}
          byokEntries={byokEntries}
          onRemoveByok={removeByokEntry}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-gray-700">
          Add your own API key
        </h3>
        <SavedKeysPicker
          addedSavedKeyIds={addedSavedKeyIds}
          onUse={addByokEntry}
        />
        <ByokModelForm onAdd={addByokEntry} />
      </div>

      <TimeEstimateLine
        mode={mode}
        modelCount={modelIds.length + byokEntries.length}
      />
      <CostEstimateLine costLimitUsd={costLimitUsd} onChange={setCostLimitUsd} />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={submitting || !question.trim() || !hasAnyModel}
        onClick={submit}
        className="self-start rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {submitting ? "Starting…" : "Start deliberation"}
      </button>
    </div>
  );
}

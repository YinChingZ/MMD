"use client";

import { useEffect, useState } from "react";
import { listModels, type ModelInfo } from "@/lib/api";
import { mergeModelSources, type ByokEntryUI } from "@/lib/model-sources";

export function ModelMultiSelect({
  selected,
  onChange,
  byokEntries,
  onRemoveByok,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  byokEntries: ByokEntryUI[];
  onRemoveByok: (clientId: string) => void;
}) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listModels().then((fetched) => {
      if (cancelled) return;
      setModels(fetched);
      onChange(fetched.map((m) => m.id));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- default selection should only be set once, on load
  }, []);

  if (!models) {
    return <p className="text-sm text-gray-500">Loading available models…</p>;
  }

  const toggle = (id: string) => {
    onChange(
      selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
    );
  };

  const rows = mergeModelSources(models, selected, byokEntries);

  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) =>
        row.kind === "legacy" ? (
          <label key={row.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={row.checked}
              onChange={() => toggle(row.label)}
            />
            <span>{row.label}</span>
            <span className="text-gray-400">({row.providerLabel})</span>
            {row.isCoordinator && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                coordinator
              </span>
            )}
          </label>
        ) : (
          <div key={row.key} className="flex items-center gap-2 text-sm">
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
              your key
            </span>
            <span>{row.label}</span>
            <span className="text-gray-400">({row.providerLabel})</span>
            <button
              type="button"
              onClick={() =>
                onRemoveByok(row.key.slice("byok:".length))
              }
              className="text-xs text-gray-400 hover:text-red-600"
              aria-label={`Remove ${row.label}`}
            >
              ×
            </button>
          </div>
        )
      )}
    </div>
  );
}

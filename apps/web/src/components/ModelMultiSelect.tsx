"use client";

import { useEffect, useState } from "react";
import { listModels, type ModelInfo } from "@/lib/api";

export function ModelMultiSelect({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
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

  return (
    <div className="flex flex-col gap-1">
      {models.map((model) => (
        <label key={model.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(model.id)}
            onChange={() => toggle(model.id)}
          />
          <span>{model.id}</span>
          <span className="text-gray-400">({model.providerLabel})</span>
          {model.isCoordinator && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              coordinator
            </span>
          )}
        </label>
      ))}
    </div>
  );
}

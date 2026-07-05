"use client";

import { useEffect, useState } from "react";
import { listWorkspaceKeys, type SavedApiKeyMetadata } from "@/lib/api";
import { formatSavedRate } from "@/lib/cost";
import type { ByokEntryUI } from "@/lib/model-sources";

export function SavedKeysPicker({
  addedSavedKeyIds,
  onUse,
}: {
  addedSavedKeyIds: string[];
  onUse: (entry: ByokEntryUI) => void;
}) {
  const [keys, setKeys] = useState<SavedApiKeyMetadata[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listWorkspaceKeys().then((fetched) => {
      if (!cancelled) setKeys(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!keys || keys.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-medium text-gray-500">
        Saved keys on this device
      </h4>
      {keys.map((key) => {
        const alreadyAdded = addedSavedKeyIds.includes(key.id);
        const label = key.label ?? `${key.providerId}:${key.modelId}`;
        return (
          <div
            key={key.id}
            className="flex items-center gap-2 text-sm text-gray-700"
          >
            <span>{label}</span>
            {key.pricing && (
              <span className="text-xs text-gray-400">
                ({formatSavedRate(key.pricing)})
              </span>
            )}
            <button
              type="button"
              disabled={alreadyAdded}
              onClick={() =>
                onUse({
                  clientId: crypto.randomUUID(),
                  label,
                  providerLabel: key.providerId,
                  payload: { savedKeyId: key.id, label: key.label ?? undefined },
                })
              }
              className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40"
            >
              {alreadyAdded ? "Added" : "Use"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

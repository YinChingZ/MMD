"use client";

import { useEffect, useState } from "react";
import { listProviders, type ProviderInfo } from "@/lib/api";
import type { ByokEntryUI } from "@/lib/model-sources";

export function ByokModelForm({
  onAdd,
}: {
  onAdd: (entry: ByokEntryUI) => void;
}) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [save, setSave] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listProviders().then((fetched) => {
      if (cancelled) return;
      setProviders(fetched);
      setProviderId(fetched[0]?.providerId ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const add = () => {
    if (!providerId || !modelId.trim() || !apiKey.trim()) return;
    const providerLabel =
      providers?.find((p) => p.providerId === providerId)?.displayName ??
      providerId;
    const trimmedLabel = label.trim();
    onAdd({
      clientId: crypto.randomUUID(),
      label: trimmedLabel || `${providerLabel}:${modelId.trim()}`,
      providerLabel,
      payload: {
        providerId,
        modelId: modelId.trim(),
        apiKey: apiKey.trim(),
        label: trimmedLabel || undefined,
        save,
      },
    });
    setModelId("");
    setApiKey("");
    setLabel("");
    setSave(false);
  };

  if (!providers) {
    return <p className="text-sm text-gray-500">Loading providers…</p>;
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-gray-200 p-3">
      <div className="flex flex-wrap gap-2">
        <select
          className="rounded border border-gray-300 px-2 py-1 text-sm"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
        >
          {providers.map((p) => (
            <option key={p.providerId} value={p.providerId}>
              {p.displayName}
            </option>
          ))}
        </select>
        <input
          className="min-w-40 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          placeholder="Model id, e.g. gpt-4.1-mini"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
        />
      </div>
      <input
        type="password"
        autoComplete="off"
        className="rounded border border-gray-300 px-2 py-1 text-sm"
        placeholder="API key"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <input
        className="rounded border border-gray-300 px-2 py-1 text-sm"
        placeholder="Label (optional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={save}
          onChange={(e) => setSave(e.target.checked)}
        />
        Remember this key for next time (encrypted, tied to this browser)
      </label>
      <button
        type="button"
        disabled={!providerId || !modelId.trim() || !apiKey.trim()}
        onClick={add}
        className="self-start rounded border border-gray-300 px-3 py-1 text-sm font-medium disabled:opacity-40"
      >
        Add model
      </button>
    </div>
  );
}

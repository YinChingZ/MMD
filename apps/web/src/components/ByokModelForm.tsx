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
  const [inputPerMillion, setInputPerMillion] = useState("");
  const [outputPerMillion, setOutputPerMillion] = useState("");

  // Suggested rate comes from GET /api/providers (computed server-side from
  // @mmd/protocol's built-in table) — the frontend never imports that
  // package's runtime code directly, same as every other model/provider list
  // here, so this stays a data fetch rather than a bundled dependency.
  const applySuggestedRate = (id: string, list: ProviderInfo[] | null) => {
    const suggested = list?.find((p) => p.providerId === id)?.suggestedRate;
    setInputPerMillion(suggested ? String(suggested.inputPerMillion) : "");
    setOutputPerMillion(suggested ? String(suggested.outputPerMillion) : "");
  };

  useEffect(() => {
    let cancelled = false;
    listProviders().then((fetched) => {
      if (cancelled) return;
      setProviders(fetched);
      const firstId = fetched[0]?.providerId ?? "";
      setProviderId(firstId);
      applySuggestedRate(firstId, fetched);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pre-fills a starting suggestion whenever the provider changes — the user
  // can accept it, adjust it, or clear it entirely (an unrecognized/OpenRouter
  // provider has no suggestion to begin with). We can't re-fetch live pricing
  // on every use, so this is a starting point, not a guarantee.
  const onProviderChange = (id: string) => {
    setProviderId(id);
    applySuggestedRate(id, providers);
  };

  const add = () => {
    if (!providerId || !modelId.trim() || !apiKey.trim()) return;
    const providerLabel =
      providers?.find((p) => p.providerId === providerId)?.displayName ??
      providerId;
    const trimmedLabel = label.trim();
    const input = Number(inputPerMillion);
    const output = Number(outputPerMillion);
    const pricing =
      input > 0 && output > 0
        ? { inputPerMillion: input, outputPerMillion: output }
        : undefined;
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
        pricing,
      },
    });
    setModelId("");
    setApiKey("");
    setLabel("");
    setSave(false);
    applySuggestedRate(providerId, providers);
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
          onChange={(e) => onProviderChange(e.target.value)}
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
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <span>Pricing ($ per 1M tokens, optional):</span>
        <input
          type="number"
          min={0}
          step="any"
          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
          placeholder="input"
          value={inputPerMillion}
          onChange={(e) => setInputPerMillion(e.target.value)}
        />
        <span>/</span>
        <input
          type="number"
          min={0}
          step="any"
          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
          placeholder="output"
          value={outputPerMillion}
          onChange={(e) => setOutputPerMillion(e.target.value)}
        />
        <span className="text-xs text-gray-400">
          Pre-filled with our best-guess rate where we have one — check it's
          still current, or clear it if you're not sure.
        </span>
      </div>
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

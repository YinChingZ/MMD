"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { formatSavedRate } from "../../lib/cost";
import { messages } from "../../lib/messages";
import { parseOutputSchema } from "../../lib/output-schema";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import type { RunConfig } from "./useRunConfig";

/**
 * 右栏「高级配置」：已保存密钥、BYOK 表单、成本上限、自定义 JSON Schema。
 * 默认收在决策面板里，不占用主输入区。
 */
export function AdvancedRunSettings({ config }: { config: RunConfig }) {
  return (
    <div className="flex flex-col gap-6">
      <SavedKeysSection config={config} />
      <ByokSection config={config} />
      <CostCapSection config={config} />
      <SchemaSection config={config} />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[13px] font-semibold text-ink">{children}</h3>
  );
}

function SavedKeysSection({ config }: { config: RunConfig }) {
  const { savedKeys, byokEntries } = config;
  if (!savedKeys || savedKeys.length === 0) return null;

  const addedSavedKeyIds = byokEntries
    .map((e) => ("savedKeyId" in e.payload ? e.payload.savedKeyId : undefined))
    .filter((id): id is string => Boolean(id));

  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>{messages.models.savedKeys}</SectionTitle>
      <ul className="flex flex-col gap-1.5">
        {savedKeys.map((key) => {
          const alreadyAdded = addedSavedKeyIds.includes(key.id);
          const label = key.label ?? `${key.providerId}:${key.modelId}`;
          return (
            <li
              key={key.id}
              className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2"
            >
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{label}</span>
                {key.pricing && (
                  <span className="block truncate font-mono text-[11px] text-ink-faint">
                    {formatSavedRate(key.pricing)}
                  </span>
                )}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={alreadyAdded}
                onClick={() =>
                  config.addByokEntry({
                    clientId: crypto.randomUUID(),
                    label,
                    providerLabel: key.providerId,
                    payload: {
                      savedKeyId: key.id,
                      label: key.label ?? undefined,
                    },
                  })
                }
              >
                {alreadyAdded ? "已添加" : messages.models.useKey}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ByokSection({ config }: { config: RunConfig }) {
  const { providers } = config;
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [save, setSave] = useState(false);
  const [inputPerMillion, setInputPerMillion] = useState("");
  const [outputPerMillion, setOutputPerMillion] = useState("");

  // Suggested rate comes from GET /api/providers (computed server-side from
  // @mmd/protocol's built-in table) — the frontend never imports that
  // package's runtime code, so this stays a data fetch.
  const applySuggestedRate = (id: string) => {
    const suggested = providers?.find((p) => p.providerId === id)?.suggestedRate;
    setInputPerMillion(suggested ? String(suggested.inputPerMillion) : "");
    setOutputPerMillion(suggested ? String(suggested.outputPerMillion) : "");
  };

  useEffect(() => {
    if (!providers?.length || providerId) return;
    const firstId = providers[0].providerId;
    setProviderId(firstId);
    const suggested = providers[0].suggestedRate;
    setInputPerMillion(suggested ? String(suggested.inputPerMillion) : "");
    setOutputPerMillion(suggested ? String(suggested.outputPerMillion) : "");
  }, [providers, providerId]);

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
    config.addByokEntry({
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
    applySuggestedRate(providerId);
  };

  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>{messages.models.addByok}</SectionTitle>
      {!providers && (
        <p className="text-sm text-ink-faint">{messages.common.loading}</p>
      )}
      {providers && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
          <select
            aria-label={messages.models.provider}
            className="h-9 rounded-sm border border-border bg-surface px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-ring"
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value);
              applySuggestedRate(e.target.value);
            }}
          >
            {providers.map((p) => (
              <option key={p.providerId} value={p.providerId}>
                {p.displayName}
              </option>
            ))}
          </select>
          <Input
            placeholder={`${messages.models.modelId}，如 gpt-4.1-mini`}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          />
          <Input
            type="password"
            autoComplete="off"
            placeholder={messages.models.apiKey}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Input
            placeholder={`${messages.models.label}（${messages.common.optional}）`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-ink-muted">
              {messages.models.pricing}
            </span>
            <Input
              type="number"
              min={0}
              step="any"
              aria-label={messages.models.pricingIn}
              placeholder={messages.models.pricingIn}
              value={inputPerMillion}
              onChange={(e) => setInputPerMillion(e.target.value)}
              className="h-8 font-mono text-xs"
            />
            <span className="text-ink-faint">/</span>
            <Input
              type="number"
              min={0}
              step="any"
              aria-label={messages.models.pricingOut}
              placeholder={messages.models.pricingOut}
              value={outputPerMillion}
              onChange={(e) => setOutputPerMillion(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
          <p className="text-xs text-ink-faint">
            已预填我们的参考费率（如有）——请核对是否仍然有效，不确定可清空。
          </p>
          <label className="flex items-center justify-between gap-2 text-sm text-ink-muted">
            {messages.models.rememberKey}
            <Switch
              checked={save}
              onCheckedChange={setSave}
              label={messages.models.rememberKey}
            />
          </label>
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            disabled={!providerId || !modelId.trim() || !apiKey.trim()}
            onClick={add}
          >
            {messages.models.add}
          </Button>
        </div>
      )}
    </section>
  );
}

function CostCapSection({ config }: { config: RunConfig }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>{messages.composer.costCap}</SectionTitle>
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-muted">$</span>
        <Input
          type="number"
          min={0.01}
          step={0.01}
          aria-label={messages.composer.costCap}
          value={config.costLimitUsd}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isFinite(value) && value > 0) config.setCostLimitUsd(value);
          }}
          className="w-28 font-mono"
        />
      </div>
      <p className="text-xs text-ink-faint">{messages.composer.costCapHint}</p>
    </section>
  );
}

function SchemaSection({ config }: { config: RunConfig }) {
  const parsed = parseOutputSchema(config.outputSchemaText);
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>{messages.jsonOutput.label}</SectionTitle>
      <p className="text-xs text-ink-faint">{messages.jsonOutput.hint}</p>
      <Textarea
        rows={7}
        aria-label={messages.jsonOutput.label}
        placeholder={'{\n  "type": "object",\n  "required": ["winner"],\n  "properties": {\n    "winner": { "type": "string" }\n  }\n}'}
        value={config.outputSchemaText}
        onChange={(e) => config.setOutputSchemaText(e.target.value)}
        className="font-mono text-xs leading-relaxed"
      />
      {!parsed.ok && (
        <p className="text-xs text-danger">
          {messages.jsonOutput.invalid}：{parsed.error}
        </p>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import { Check, ChevronDown, Crown, Star, X } from "lucide-react";
import { formatCostUsd } from "../../lib/format";
import { messages } from "../../lib/messages";
import { modelColor, modelInitials } from "../../lib/model-colors";
import { cn } from "../../lib/cn";
import { getDefaultModels, isLegacyDefault, toggleLegacyDefault } from "../../lib/default-models";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../ui/popover";
import { IconButton } from "../ui/icon-button";
import { Badge } from "../ui/badge";
import { usePanelContext } from "../shell/WorkspaceShell";
import type { RunConfig } from "./useRunConfig";

const MODES = ["standard", "quick", "planning"] as const;

/** 输入器底部的紧凑预设条：模式 / 模型 / 预计耗时 / 成本上限摘要。 */
export function RunPresetBar({ config }: { config: RunConfig }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <ModePicker config={config} />
      <ModelPicker config={config} />
      <span className="hidden truncate text-xs text-ink-faint sm:inline">
        {messages.composer.timeEstimates[config.mode]} ·{" "}
        {messages.composer.costCapSummary(formatCostUsd(config.costLimitUsd))}
      </span>
    </div>
  );
}

function chipClass(active = false) {
  return cn(
    "inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-xs font-medium text-ink-muted transition-colors",
    "hover:border-border-strong hover:text-ink",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    active && "border-accent/40 bg-accent-muted text-accent",
  );
}

function ModePicker({ config }: { config: RunConfig }) {
  return (
    <Popover>
      <PopoverTrigger className={chipClass()}>
        {messages.modes[config.mode].name}
        <ChevronDown className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1.5">
        <p className="px-2 pb-1 pt-1 text-xs font-medium text-ink-faint">
          {messages.modes.label}
        </p>
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => config.setMode(m)}
            className={cn(
              "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-surface-hover",
            )}
          >
            <Check
              className={cn(
                "mt-0.5 h-3.5 w-3.5 shrink-0 text-accent",
                config.mode !== m && "invisible",
              )}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">
                {messages.modes[m].name}
              </span>
              <span className="block text-xs text-ink-muted">
                {messages.modes[m].hint}
              </span>
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ModelPicker({ config }: { config: RunConfig }) {
  const { models, modelIds, byokEntries } = config;
  const panel = usePanelContext();
  const [defaults, setDefaults] = useState(() => getDefaultModels());
  return (
    <Popover>
      <PopoverTrigger className={chipClass(config.selectedCount > 0)}>
        {config.selectedCount > 0
          ? messages.composer.modelsSelected(config.selectedCount)
          : messages.composer.noModels}
        <ChevronDown className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent className="w-80 p-1.5">
        <p className="px-2 pb-1 pt-1 text-xs font-medium text-ink-faint">
          {messages.models.sectionServer}
        </p>
        {models === null && (
          <p className="px-2 py-1 text-sm text-ink-faint">
            {messages.common.loading}
          </p>
        )}
        {models?.map((m) => {
          const checked = modelIds.includes(m.id);
          const color = modelColor(m.id);
          const starred = isLegacyDefault(defaults, m.id);
          return (
            <div
              key={m.id}
              className="flex w-full items-center gap-1 rounded-sm px-1 py-0.5 transition-colors hover:bg-surface-hover"
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => config.toggleModel(m.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-1 text-left"
              >
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                  style={{ backgroundColor: color.bg, color: color.fg }}
                >
                  {modelInitials(m.id)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{m.id}</span>
                  <span className="flex items-center gap-1 text-xs text-ink-faint">
                    {m.providerLabel}
                    {m.isCoordinator && (
                      <span className="inline-flex items-center gap-0.5 text-accent">
                        <Crown className="h-3 w-3" />
                        {messages.models.coordinator}
                      </span>
                    )}
                    {m.isMock && <Badge tone="neutral">{messages.models.mockBadge}</Badge>}
                  </span>
                </span>
              </button>
              <IconButton
                size="sm"
                label={messages.models.toggleDefault}
                onClick={() => setDefaults(toggleLegacyDefault(defaults, m.id))}
              >
                <Star
                  className={cn(
                    "h-3.5 w-3.5",
                    starred ? "fill-accent text-accent" : "text-ink-faint",
                  )}
                />
              </IconButton>
              <Check
                className={cn(
                  "h-4 w-4 shrink-0 text-accent",
                  !checked && "invisible",
                )}
              />
            </div>
          );
        })}

        {byokEntries.length > 0 && (
          <>
            <p className="border-t border-border px-2 pb-1 pt-2 text-xs font-medium text-ink-faint">
              {messages.models.sectionByok}
            </p>
            {byokEntries.map((entry) => {
              const color = modelColor(entry.label);
              return (
                <div
                  key={entry.clientId}
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5"
                >
                  <span
                    aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                    style={{ backgroundColor: color.bg, color: color.fg }}
                  >
                    {modelInitials(entry.label)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {entry.label}
                    </span>
                    <span className="text-xs text-ink-faint">
                      {entry.providerLabel} · {messages.models.yourKey}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`${messages.common.remove} ${entry.label}`}
                    onClick={() => config.removeByokEntry(entry.clientId)}
                    className="rounded-sm p-1 text-ink-faint transition-colors hover:bg-surface-hover hover:text-danger"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </>
        )}

        <PopoverClose asChild>
          <button
            type="button"
            onClick={() => panel?.expand()}
            className="mt-1 flex w-full items-center gap-1 border-t border-border px-2 pb-1 pt-2 text-left text-xs text-ink-faint transition-colors hover:text-accent"
          >
            {messages.models.addByok} → {messages.composer.advancedSettings}
          </button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}

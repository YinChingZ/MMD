"use client";

import { useEffect, useState } from "react";
import type { RunMode } from "@mmd/protocol";
import { toast } from "sonner";
import {
  listModels,
  listProviders,
  listWorkspaceKeys,
  type ModelInfo,
  type ProviderInfo,
  type SavedApiKeyMetadata,
} from "../../lib/api";
import {
  readImageFiles,
  validateImageFiles,
  type SelectedImage,
} from "../../lib/image-input";
import { messages } from "../../lib/messages";
import type { ByokEntryUI } from "../../lib/model-sources";

// Mirrors apps/api/src/routes/runs.ts's DEFAULT_COST_LIMIT_USD — kept as an
// independent constant since the two apps don't share a config package for
// a single number, not because the value is meant to drift between them.
export const DEFAULT_COST_LIMIT_USD = 5;

/**
 * 一次运行的全部配置状态，供中央输入器（DecisionComposer/RunPresetBar）
 * 与右栏高级配置（AdvancedRunSettings）共享 —— 在页面层持有，两处消费。
 */
export interface RunConfig {
  mode: RunMode;
  setMode: (m: RunMode) => void;
  models: ModelInfo[] | null;
  modelIds: string[];
  toggleModel: (id: string) => void;
  byokEntries: ByokEntryUI[];
  addByokEntry: (entry: ByokEntryUI) => void;
  removeByokEntry: (clientId: string) => void;
  providers: ProviderInfo[] | null;
  savedKeys: SavedApiKeyMetadata[] | null;
  costLimitUsd: number;
  setCostLimitUsd: (v: number) => void;
  outputSchemaText: string;
  setOutputSchemaText: (v: string) => void;
  webSearch: boolean;
  setWebSearch: (v: boolean) => void;
  images: SelectedImage[];
  addImages: (files: FileList | null) => Promise<void>;
  removeImage: (id: string) => void;
  hasAnyModel: boolean;
  selectedCount: number;
}

export function useRunConfig(): RunConfig {
  const [mode, setMode] = useState<RunMode>("standard");
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [byokEntries, setByokEntries] = useState<ByokEntryUI[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [savedKeys, setSavedKeys] = useState<SavedApiKeyMetadata[] | null>(null);
  const [costLimitUsd, setCostLimitUsd] = useState(DEFAULT_COST_LIMIT_USD);
  const [outputSchemaText, setOutputSchemaText] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [images, setImages] = useState<SelectedImage[]>([]);

  useEffect(() => {
    let cancelled = false;
    listModels()
      .then((fetched) => {
        if (cancelled) return;
        setModels(fetched);
        // 默认全选内置模型（沿用原 ModelMultiSelect 行为），仅初始化一次。
        setModelIds(fetched.map((m) => m.id));
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    listProviders()
      .then((fetched) => !cancelled && setProviders(fetched))
      .catch(() => !cancelled && setProviders([]));
    listWorkspaceKeys()
      .then((fetched) => !cancelled && setSavedKeys(fetched))
      .catch(() => !cancelled && setSavedKeys([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleModel = (id: string) =>
    setModelIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    const validationError = validateImageFiles(selected, images);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    try {
      const next = await readImageFiles(selected);
      setImages((previous) => [...previous, ...next]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : messages.errors.imageInvalid);
    }
  };

  return {
    mode,
    setMode,
    models,
    modelIds,
    toggleModel,
    byokEntries,
    addByokEntry: (entry) => setByokEntries((prev) => [...prev, entry]),
    removeByokEntry: (clientId) =>
      setByokEntries((prev) => prev.filter((e) => e.clientId !== clientId)),
    providers,
    savedKeys,
    costLimitUsd,
    setCostLimitUsd,
    outputSchemaText,
    setOutputSchemaText,
    webSearch,
    setWebSearch,
    images,
    addImages,
    removeImage: (id) =>
      setImages((current) => current.filter((item) => item.id !== id)),
    hasAnyModel: modelIds.length > 0 || byokEntries.length > 0,
    selectedCount: modelIds.length + byokEntries.length,
  };
}

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
import { getDefaultModels } from "../../lib/default-models";
import {
  readImageFiles,
  validateImageFiles,
  type SelectedImage,
} from "../../lib/image-input";
import { messages } from "../../lib/messages";
import { dedupeByokEntries, type ByokEntryUI } from "../../lib/model-sources";

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
  setModelIds: (ids: string[]) => void;
  toggleModel: (id: string) => void;
  byokEntries: ByokEntryUI[];
  addByokEntry: (entry: ByokEntryUI) => void;
  replaceByokEntries: (entries: ByokEntryUI[]) => void;
  removeByokEntry: (clientId: string) => void;
  providers: ProviderInfo[] | null;
  savedKeys: SavedApiKeyMetadata[] | null;
  removeSavedKey: (id: string) => void;
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

    listProviders()
      .then((fetched) => !cancelled && setProviders(fetched))
      .catch(() => !cancelled && setProviders([]));

    // 模型与已存密钥必须一起等待——默认选择规则依赖"是否有已存密钥"，
    // 分开设置会在密钥还没到时就用错误的规则选中模型。
    const modelsPromise = listModels().catch(() => [] as ModelInfo[]);
    const savedKeysPromise = listWorkspaceKeys().catch(
      () => [] as SavedApiKeyMetadata[],
    );

    Promise.all([modelsPromise, savedKeysPromise]).then(
      ([fetchedModels, fetchedKeys]) => {
        if (cancelled) return;
        setModels(fetchedModels);
        setSavedKeys(fetchedKeys);

        const marks = getDefaultModels();
        if (marks.length > 0) {
          // 用户已标记默认模型：始终优先于下方的通用规则。
          const legacyIds = marks
            .filter((m) => m.kind === "legacy")
            .map((m) => (m as { id: string }).id)
            .filter((id) => fetchedModels.some((m) => m.id === id));
          setModelIds(legacyIds);
          for (const mark of marks) {
            if (mark.kind !== "byokSavedKey") continue;
            if (!fetchedKeys.some((k) => k.id === mark.savedKeyId)) continue;
            setByokEntries((prev) => dedupeByokEntries([
              ...prev,
              {
                clientId: crypto.randomUUID(),
                label: mark.label,
                providerLabel: mark.providerLabel,
                payload: { savedKeyId: mark.savedKeyId },
              },
            ]));
          }
        } else if (fetchedKeys.length > 0) {
          // 有已存密钥：默认选内置列表前三个，而非全部。
          setModelIds(fetchedModels.slice(0, 3).map((m) => m.id));
        } else {
          // 无已存密钥（含 mock 注册表场景）：默认不选任何模型。
          setModelIds([]);
        }
      },
    );

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
    setModelIds,
    toggleModel,
    byokEntries,
    addByokEntry: (entry) =>
      setByokEntries((prev) => dedupeByokEntries([...prev, entry])),
    replaceByokEntries: (entries) => setByokEntries(dedupeByokEntries(entries)),
    removeByokEntry: (clientId) =>
      setByokEntries((prev) => prev.filter((e) => e.clientId !== clientId)),
    providers,
    savedKeys,
    removeSavedKey: (id) =>
      setSavedKeys((prev) => (prev ? prev.filter((k) => k.id !== id) : prev)),
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

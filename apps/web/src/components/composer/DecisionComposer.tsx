"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ArrowUp, Globe, ImagePlus, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { messages } from "../../lib/messages";
import { IconButton } from "../ui/icon-button";
import { RunPresetBar } from "./RunPresetBar";
import type { RunConfig } from "./useRunConfig";

/**
 * 中央决策输入器：多行输入 + 图片附件 + 联网开关 + 预设条 + 提交。
 * 配置状态由页面层的 useRunConfig 提供，与右栏高级配置共享。
 */
export function DecisionComposer({
  config,
  onSubmit,
  submitting,
  placeholder,
  initialQuestion,
  autoFocus,
}: {
  config: RunConfig;
  onSubmit: (question: string) => void;
  submitting: boolean;
  placeholder?: string;
  initialQuestion?: string;
  autoFocus?: boolean;
}) {
  const [question, setQuestion] = useState(initialQuestion ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 首页示例 chip / 跨页预填
  useEffect(() => {
    if (initialQuestion !== undefined) setQuestion(initialQuestion);
  }, [initialQuestion]);

  // 自增高
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [question]);

  const configurationError =
    config.mode === "quick" && config.selectedCount !== 2
      ? messages.errors.quickRequiresTwoModels(config.selectedCount)
      : undefined;
  const canSubmit =
    !submitting &&
    !configurationError &&
    question.trim().length > 0 &&
    config.hasAnyModel;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(question.trim());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface shadow-raised transition-colors",
        "focus-within:border-accent/50",
      )}
    >
      <textarea
        ref={textareaRef}
        rows={2}
        autoFocus={autoFocus}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? messages.composer.placeholder}
        aria-label={messages.composer.placeholder}
        className="max-h-60 w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
      />

      {config.images.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-1">
          {config.images.map((image) => (
            <div
              key={image.id}
              className="group relative overflow-hidden rounded-sm border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.dataUrl}
                alt={image.name}
                className="h-14 w-14 object-cover"
              />
              <button
                type="button"
                aria-label={`${messages.common.remove} ${image.name}`}
                onClick={() => config.removeImage(image.id)}
                className="absolute right-0.5 top-0.5 rounded-full bg-ink/60 p-0.5 text-surface opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {configurationError && (
        <p className="px-4 pb-1 pt-1 text-xs text-danger" role="alert">
          {configurationError}
        </p>
      )}

      <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(event) => {
            void config.addImages(event.target.files);
            event.target.value = "";
          }}
        />
        <IconButton
          size="sm"
          label={`${messages.composer.attachImage}（${messages.composer.imageHint}）`}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus className="h-4 w-4" />
        </IconButton>
        <button
          type="button"
          role="switch"
          aria-checked={config.webSearch}
          title={messages.composer.webSearchHint}
          onClick={() => config.setWebSearch(!config.webSearch)}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-xs font-medium text-ink-muted transition-colors",
            "hover:border-border-strong hover:text-ink",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            config.webSearch && "border-accent/40 bg-accent-muted text-accent",
          )}
        >
          <Globe className="h-3.5 w-3.5" />
          {messages.composer.webSearch}
        </button>

        <div className="min-w-0 flex-1">
          <RunPresetBar config={config} />
        </div>

        <button
          type="button"
          aria-label={messages.composer.submit}
          title={`${messages.composer.submit}（${messages.composer.enterToSend}）`}
          disabled={!canSubmit}
          onClick={submit}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-card transition-colors",
            "hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

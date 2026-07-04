"use client";

import { useState } from "react";
import { Markdown } from "./Markdown";

export function FinalAnswerPanel({
  title,
  text,
}: {
  title?: string;
  text: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded border border-gray-200 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title ?? "Final answer"}</h2>
        <button
          type="button"
          onClick={copy}
          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <Markdown text={text} />
    </div>
  );
}

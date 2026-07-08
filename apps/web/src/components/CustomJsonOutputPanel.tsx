"use client";

import { useState } from "react";

/**
 * M6.1: renders the caller's reformatted userOutput alongside the normal
 * result — shown only when the run requested a custom outputFormat.
 */
export function CustomJsonOutputPanel({ userOutput }: { userOutput: unknown }) {
  const [copied, setCopied] = useState(false);
  const pretty = JSON.stringify(userOutput, null, 2);

  const copy = async () => {
    await navigator.clipboard.writeText(pretty);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Custom JSON output</h3>
        <button
          type="button"
          onClick={copy}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded bg-gray-50 p-2 text-xs">{pretty}</pre>
    </div>
  );
}

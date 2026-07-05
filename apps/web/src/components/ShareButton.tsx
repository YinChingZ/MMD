"use client";

import { useState } from "react";
import { createShareLink, revokeShareLink } from "@/lib/api";

export function ShareButton({ runId }: { runId: string }) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const share = async () => {
    setLoading(true);
    try {
      const { token } = await createShareLink(runId);
      setShareUrl(`${window.location.origin}/share/${token}`);
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const unshare = async () => {
    await revokeShareLink(runId);
    setShareUrl(null);
  };

  if (!shareUrl) {
    return (
      <button
        type="button"
        onClick={share}
        disabled={loading}
        className="self-start rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
      >
        {loading ? "Sharing…" : "Share"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded border border-gray-200 p-2 text-xs">
      <input
        readOnly
        value={shareUrl}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 truncate bg-transparent text-gray-600"
      />
      <button
        type="button"
        onClick={copy}
        className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <button
        type="button"
        onClick={unshare}
        className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
      >
        Unshare
      </button>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import { toast } from "sonner";
import { createShareLink, revokeShareLink } from "@/lib/api";
import { messages } from "@/lib/messages";
import { Button } from "./ui/button";

/**
 * 分享入口（完成态顶部操作区）：创建即复制链接到剪贴板，
 * 已分享时提供撤销。M5.5：创建是幂等的，同一 run 返回同一 token。
 */
export function ShareButton({ runId }: { runId: string }) {
  const [shared, setShared] = useState(false);
  const [loading, setLoading] = useState(false);

  const share = async () => {
    setLoading(true);
    try {
      const { token } = await createShareLink(runId);
      const url = `${window.location.origin}/share/${token}`;
      await navigator.clipboard.writeText(url);
      setShared(true);
      toast.success(messages.results.shareCreated, { description: url });
    } catch {
      toast.error(messages.results.shareFailed);
    } finally {
      setLoading(false);
    }
  };

  const unshare = async () => {
    setLoading(true);
    try {
      await revokeShareLink(runId);
      setShared(false);
      toast.success(messages.results.shareRevoked);
    } catch {
      toast.error(messages.results.shareFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="secondary" disabled={loading} onClick={share}>
        <Link2 className="h-3.5 w-3.5" />
        {messages.results.share}
      </Button>
      {shared && (
        <Button size="sm" variant="ghost" disabled={loading} onClick={unshare}>
          <Link2Off className="h-3.5 w-3.5" />
          {messages.results.shareRevoke}
        </Button>
      )}
    </span>
  );
}

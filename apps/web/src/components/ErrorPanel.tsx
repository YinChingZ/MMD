import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { messages } from "@/lib/messages";

/**
 * 失败卡：失败阶段（如可知）、原因、可执行的重试入口。
 * 返回会话页后输入器可重新发起（配置默认值不丢协议能力）。
 */
export function ErrorPanel({
  error,
  failedPhase,
  retryHref,
}: {
  error: string | null;
  failedPhase?: string;
  retryHref?: string;
}) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger-muted p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-danger">
        <AlertTriangle className="h-4 w-4" />
        {failedPhase
          ? messages.run.failedAtPhase(
              messages.run.phases[failedPhase] ?? failedPhase,
            )
          : messages.run.failedGeneric}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink">
        {error ?? messages.errors.generic}
      </p>
      {retryHref && (
        <Link
          href={retryHref}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {messages.common.retry}
        </Link>
      )}
    </div>
  );
}

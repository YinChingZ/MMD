import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { messages } from "@/lib/messages";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-8 text-center">
      <BrandMark className="h-10 w-10 opacity-60" />
      <h1 className="text-lg font-semibold text-ink">404</h1>
      <p className="text-sm text-ink-muted">页面不存在或已被删除</p>
      <Link href="/" className="text-sm font-medium text-accent hover:text-accent-hover">
        返回 {messages.common.appName}
      </Link>
    </div>
  );
}

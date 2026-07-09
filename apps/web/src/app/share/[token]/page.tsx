import type { Metadata } from "next";
import { SharePageClient } from "./SharePageClient";

export const metadata: Metadata = {
  title: "共享的协商结果",
  description:
    "由多个大模型经提议、质疑、修订与投票协商产出的决策结论（MMD 分享链接）。",
};

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharePageClient token={token} />;
}

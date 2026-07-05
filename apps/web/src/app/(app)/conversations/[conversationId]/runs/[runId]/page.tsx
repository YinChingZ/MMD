import { RunPageClient } from "./RunPageClient";

export default async function RunPage({
  params,
}: {
  params: Promise<{ conversationId: string; runId: string }>;
}) {
  const { runId } = await params;
  return <RunPageClient runId={runId} />;
}

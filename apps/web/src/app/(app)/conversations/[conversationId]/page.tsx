import { ConversationPageClient } from "./ConversationPageClient";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <ConversationPageClient conversationId={conversationId} />;
}

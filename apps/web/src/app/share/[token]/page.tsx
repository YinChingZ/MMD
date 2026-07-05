import { SharePageClient } from "./SharePageClient";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharePageClient token={token} />;
}

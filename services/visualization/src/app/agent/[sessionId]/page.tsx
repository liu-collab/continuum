export default async function AgentSessionPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  await params;
  return null;
}

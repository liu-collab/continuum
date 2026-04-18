import { AgentWorkspace } from "../_components/agent-workspace";

export default async function AgentSessionPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <AgentWorkspace sessionId={sessionId} />;
}

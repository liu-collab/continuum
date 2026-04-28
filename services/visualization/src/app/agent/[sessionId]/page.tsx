import React from "react";

import { AgentRouteShell } from "../_components/agent-route-shell";

export default async function AgentSessionPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <AgentRouteShell sessionId={sessionId} />;
}

import React from "react";

import { AgentWorkspace } from "./agent-workspace";

export function AgentRouteShell({ sessionId }: { sessionId?: string }) {
  return <AgentWorkspace sessionId={sessionId} />;
}

import type { ReactNode } from "react";

import { AgentRouteShell } from "./_components/agent-route-shell";

export default function AgentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="agent-workbench-page">
      <AgentRouteShell />
      <div className="hidden">{children}</div>
    </div>
  );
}

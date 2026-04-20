"use client";

import { usePathname } from "next/navigation";

import { AgentWorkspace } from "./agent-workspace";

export function AgentRouteShell() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const sessionId = segments[0] === "agent" ? segments[1] : undefined;

  return <AgentWorkspace sessionId={sessionId} />;
}

import React, { type ReactNode } from "react";

export default function AgentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="agent-workbench-page">
      {children}
    </div>
  );
}

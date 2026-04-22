import type { ReactNode } from "react";

import { getAppConfig } from "@/lib/env";

import { AgentRouteShell } from "./_components/agent-route-shell";
import { AgentI18nProvider } from "./_i18n/provider";

export default function AgentLayout({ children }: { children: ReactNode }) {
  return (
    <AgentI18nProvider defaultLocale={getAppConfig().values.NEXT_PUBLIC_MNA_DEFAULT_LOCALE}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <AgentRouteShell />
        <div className="hidden">{children}</div>
      </div>
    </AgentI18nProvider>
  );
}

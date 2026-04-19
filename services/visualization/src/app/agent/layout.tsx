import type { ReactNode } from "react";

import { getAppConfig } from "@/lib/env";

import { AgentI18nProvider } from "./_i18n/provider";

export default function AgentLayout({ children }: { children: ReactNode }) {
  return (
    <AgentI18nProvider defaultLocale={getAppConfig().values.NEXT_PUBLIC_MNA_DEFAULT_LOCALE}>
      <div className="space-y-6">{children}</div>
    </AgentI18nProvider>
  );
}

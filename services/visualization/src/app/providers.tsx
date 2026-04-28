"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PropsWithChildren, useState } from "react";

import { AppI18nProvider } from "@/lib/i18n/client";

type ProvidersProps = PropsWithChildren<{
  defaultLocale?: string;
}>;

export function Providers({ children, defaultLocale }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 300_000,
            refetchOnWindowFocus: false,
            retry: false
          }
        }
      })
  );

  return (
    <AppI18nProvider defaultLocale={defaultLocale}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppI18nProvider>
  );
}

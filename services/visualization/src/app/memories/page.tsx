import React from "react";

import { getMemoryCatalog } from "@/features/memory-catalog/service";
import { getServerTranslator } from "@/lib/i18n/server";
import { parseMemoryCatalogFilters } from "@/lib/query-params";

import { MemoriesWorkspace } from "./memories-workspace";

export default async function MemoriesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { locale } = await getServerTranslator();
  const filters = parseMemoryCatalogFilters(params);
  const response = await getMemoryCatalog(filters);

  return (
    <MemoriesWorkspace
      initialResponse={response}
      initialFilters={filters}
      locale={locale}
    />
  );
}

import type { Route } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { MemoryCatalogItem } from "@/lib/contracts";
import { formatTimestamp } from "@/lib/format";
import { createTranslator, DEFAULT_APP_LOCALE, type AppLocale } from "@/lib/i18n/messages";

export function MemoryTable({
  items,
  locale = DEFAULT_APP_LOCALE
}: {
  items: MemoryCatalogItem[];
  locale?: AppLocale;
}) {
  const t = createTranslator(locale);
  const columns: Array<DataTableColumn<MemoryCatalogItem>> = [
    {
      header: t("memories.table.memory"),
      cell: (item) => (
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <Link
              href={`/memories/${encodeURIComponent(item.id)}` as Route}
              className="group flex min-w-0 items-start gap-1 text-foreground hover:text-accent"
            >
              <span className="font-medium">{item.summary}</span>
              <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
            </Link>
          </div>
          <div className="mt-1 text-[14px] leading-[1.43] text-muted-foreground">{item.visibilitySummary}</div>
        </div>
      )
    },
    {
      header: t("memories.table.type"),
      cell: (item) => (
        <span className="text-xs text-muted-foreground">{item.memoryTypeLabel}</span>
      )
    },
    {
      header: t("memories.table.scope"),
      cell: (item) => (
        <StatusBadge tone={item.scope === "user" ? "warning" : "neutral"}>
          {item.scopeLabel}
        </StatusBadge>
      )
    },
    {
      header: t("memories.table.status"),
      cell: (item) => (
        <StatusBadge
          tone={
            item.status === "active"
              ? "success"
              : item.status === "pending_confirmation"
                ? "warning"
                : "neutral"
          }
        >
          {item.statusLabel}
        </StatusBadge>
      )
    },
    {
      header: t("memories.table.source"),
      cell: (item) => (
        <div className="max-w-xs">
          <div className="text-xs text-foreground">{item.originWorkspaceLabel}</div>
          <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{item.sourceSummary}</div>
        </div>
      )
    },
    {
      header: t("memories.table.updated"),
      cell: (item) => (
        <span className="text-xs text-muted-foreground">{formatTimestamp(item.updatedAt, locale)}</span>
      )
    }
  ];

  return <DataTable columns={columns} data={items} getRowKey={(item) => item.id} />;
}

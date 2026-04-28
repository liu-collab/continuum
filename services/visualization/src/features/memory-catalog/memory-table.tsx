"use client";

import type { Route } from "next";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpRight } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { MemoryCatalogItem } from "@/lib/contracts";
import { formatTimestamp } from "@/lib/format";
import { useAppI18n } from "@/lib/i18n/client";

export function MemoryTable({ items }: { items: MemoryCatalogItem[] }) {
  const { locale, t } = useAppI18n();
  const columns: Array<ColumnDef<MemoryCatalogItem>> = [
    {
      header: t("memories.table.memory"),
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <Link
              href={`/memories/${encodeURIComponent(row.original.id)}` as Route}
              className="group flex min-w-0 items-start gap-1 text-foreground hover:text-accent"
            >
              <span className="font-medium">{row.original.summary}</span>
              <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
            </Link>
          </div>
          <div className="mt-1 text-[14px] leading-[1.43] text-muted-foreground">{row.original.visibilitySummary}</div>
        </div>
      )
    },
    {
      header: t("memories.table.type"),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.memoryTypeLabel}</span>
      )
    },
    {
      header: t("memories.table.scope"),
      cell: ({ row }) => (
        <StatusBadge tone={row.original.scope === "user" ? "warning" : "neutral"}>
          {row.original.scopeLabel}
        </StatusBadge>
      )
    },
    {
      header: t("memories.table.status"),
      cell: ({ row }) => (
        <StatusBadge
          tone={
            row.original.status === "active"
              ? "success"
              : row.original.status === "pending_confirmation"
                ? "warning"
                : "neutral"
          }
        >
          {row.original.statusLabel}
        </StatusBadge>
      )
    },
    {
      header: t("memories.table.source"),
      cell: ({ row }) => (
        <div className="max-w-xs">
          <div className="text-xs text-foreground">{row.original.originWorkspaceLabel}</div>
          <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{row.original.sourceSummary}</div>
        </div>
      )
    },
    {
      header: t("memories.table.updated"),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatTimestamp(row.original.updatedAt, locale)}</span>
      )
    }
  ];

  return <DataTable columns={columns} data={items} />;
}

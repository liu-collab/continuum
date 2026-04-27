"use client";

import type { Route } from "next";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpRight } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { MemoryCatalogItem } from "@/lib/contracts";
import { formatTimestamp } from "@/lib/format";

const columns: Array<ColumnDef<MemoryCatalogItem>> = [
  {
    header: "记忆",
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
    header: "类型",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{row.original.memoryTypeLabel}</span>
    )
  },
  {
    header: "作用域",
    cell: ({ row }) => (
      <StatusBadge tone={row.original.scope === "user" ? "warning" : "neutral"}>
        {row.original.scopeLabel}
      </StatusBadge>
    )
  },
  {
    header: "状态",
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
    header: "来源",
    cell: ({ row }) => (
      <div className="max-w-xs">
        <div className="text-xs text-foreground">{row.original.originWorkspaceLabel}</div>
        <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{row.original.sourceSummary}</div>
      </div>
    )
  },
  {
    header: "更新",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{formatTimestamp(row.original.updatedAt)}</span>
    )
  }
];

export function MemoryTable({ items }: { items: MemoryCatalogItem[] }) {
  return <DataTable columns={columns} data={items} />;
}

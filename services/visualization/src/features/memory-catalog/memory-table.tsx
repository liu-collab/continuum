"use client";

import type { Route } from "next";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { MemoryCatalogItem } from "@/lib/contracts";
import { formatTimestamp } from "@/lib/format";

const columns: Array<ColumnDef<MemoryCatalogItem>> = [
  {
    header: "记忆",
    cell: ({ row }) => (
      <div>
        <div className="font-semibold text-slate-900">{row.original.summary}</div>
        <div className="mt-1 text-xs text-slate-500">{row.original.id}</div>
        <div className="mt-2 text-xs leading-5 text-slate-500">{row.original.visibilitySummary}</div>
        <Link
          href={`/memories/${encodeURIComponent(row.original.id)}` as Route}
          className="mt-2 inline-flex text-xs font-semibold text-accent hover:underline"
        >
          查看详情
        </Link>
      </div>
    )
  },
  {
    header: "类型",
    cell: ({ row }) => row.original.memoryTypeLabel
  },
  {
    header: "作用域",
    cell: ({ row }) => (
      <div className="space-y-2">
        <StatusBadge tone={row.original.scope === "user" ? "warning" : "neutral"}>
          {row.original.scopeLabel}
        </StatusBadge>
        <div className="max-w-xs text-xs leading-5 text-slate-500">{row.original.scopeExplanation}</div>
      </div>
    )
  },
  {
    header: "状态",
    cell: ({ row }) => (
      <div className="space-y-2">
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
        <div className="max-w-xs text-xs leading-5 text-slate-500">
          {row.original.statusExplanation}
        </div>
      </div>
    )
  },
  {
    header: "来源",
    cell: ({ row }) => (
      <div>
        <div>{row.original.originWorkspaceLabel}</div>
        <div className="mt-1 text-xs text-slate-500">{row.original.sourceSummary}</div>
      </div>
    )
  },
  {
    header: "更新时间",
    cell: ({ row }) => formatTimestamp(row.original.updatedAt)
  }
];

export function MemoryTable({ items }: { items: MemoryCatalogItem[] }) {
  return <DataTable columns={columns} data={items} />;
}

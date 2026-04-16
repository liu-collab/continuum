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
    header: "Memory",
    cell: ({ row }) => (
      <div>
        <div className="font-semibold text-slate-900">{row.original.summary}</div>
        <div className="mt-1 text-xs text-slate-500">{row.original.id}</div>
        <Link
          href={`/memories/${encodeURIComponent(row.original.id)}` as Route}
          className="mt-2 inline-flex text-xs font-semibold text-accent hover:underline"
        >
          View details
        </Link>
      </div>
    )
  },
  {
    header: "Type",
    cell: ({ row }) => row.original.memoryTypeLabel
  },
  {
    header: "Scope",
    cell: ({ row }) => row.original.scopeLabel
  },
  {
    header: "Status",
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
    header: "Source",
    cell: ({ row }) => (
      <div>
        <div>{row.original.sourceType ?? "Unknown"}</div>
        <div className="mt-1 text-xs text-slate-500">{row.original.sourceRef ?? "No source ref"}</div>
        {row.original.sourceServiceName ? (
          <div className="mt-1 text-xs text-slate-400">{row.original.sourceServiceName}</div>
        ) : null}
      </div>
    )
  },
  {
    header: "Updated",
    cell: ({ row }) => formatTimestamp(row.original.updatedAt)
  }
];

export function MemoryTable({ items }: { items: MemoryCatalogItem[] }) {
  return <DataTable columns={columns} data={items} />;
}

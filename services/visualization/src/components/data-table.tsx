"use client";

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";

type DataTableProps<TData> = {
  columns: Array<ColumnDef<TData>>;
  data: TData[];
};

export function DataTable<TData>({ columns, data }: DataTableProps<TData>) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="overflow-hidden border border-border" style={{ borderRadius: "var(--radius-lg)" }}>
      <div className="overflow-x-auto">
        <table className="min-w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} style={{ borderBottom: "1px solid var(--border)" }}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{
                      padding: "0.5rem 0.875rem",
                      textAlign: "left",
                      fontSize: "0.625rem",
                      fontWeight: 500,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-mono)"
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                style={{ borderBottom: "1px solid var(--border)" }}
                className="transition-colors hover:bg-surface-hover"
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    style={{
                      padding: "0.625rem 0.875rem",
                      fontSize: "0.8125rem",
                      color: "var(--text)",
                      fontFamily: "var(--font-mono)"
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

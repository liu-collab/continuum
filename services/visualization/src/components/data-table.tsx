import React, { type ReactNode } from "react";

export type DataTableColumn<TData> = {
  header: ReactNode;
  cell(row: TData): ReactNode;
};

type DataTableProps<TData> = {
  columns: Array<DataTableColumn<TData>>;
  data: TData[];
  getRowKey?(row: TData, index: number): string;
};

export function DataTable<TData>({ columns, data, getRowKey }: DataTableProps<TData>) {
  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-border">
              {columns.map((column, index) => (
                <th
                  key={index}
                  className="bg-[var(--surface-pearl)] px-[17px] py-3 text-left text-[14px] font-semibold leading-[1.29] text-muted-foreground"
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIndex) => (
              <tr
                key={getRowKey?.(row, rowIndex) ?? rowIndex}
                className="border-b border-border transition-colors last:border-0 hover:bg-surface-hover"
              >
                {columns.map((column, columnIndex) => (
                  <td
                    key={columnIndex}
                    className="px-[17px] py-[17px] text-[17px] leading-[1.47] text-text"
                  >
                    {column.cell(row)}
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

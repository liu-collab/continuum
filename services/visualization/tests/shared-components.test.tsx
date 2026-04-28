import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";

describe("shared display components", () => {
  it("renders data table rows without client table state", () => {
    render(
      <DataTable
        data={[
          { id: "memory-1", summary: "User prefers concise answers" }
        ]}
        columns={[
          {
            header: "Memory",
            cell: (row) => row.summary
          }
        ]}
        getRowKey={(row) => row.id}
      />
    );

    expect(screen.getByRole("columnheader", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByText("User prefers concise answers")).toBeInTheDocument();
  });

  it("renders status badge tone classes without client hooks", () => {
    render(<StatusBadge tone="warning">Partial</StatusBadge>);

    expect(screen.getByText("Partial")).toHaveClass("status-badge", "status-warning");
  });
});

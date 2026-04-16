import { describe, expect, it } from "vitest";

import {
  parseDashboardWindow,
  parseMemoryCatalogFilters,
  parseRunTraceFilters
} from "@/lib/query-params";

describe("query param parsing", () => {
  it("parses memory catalog filters with defaults", () => {
    const filters = parseMemoryCatalogFilters(
      new URLSearchParams({
        workspace_id: "ws-1",
        memory_type: "fact_preference"
      })
    );

    expect(filters).toEqual({
      workspaceId: "ws-1",
      userId: undefined,
      taskId: undefined,
      memoryType: "fact_preference",
      scope: undefined,
      status: undefined,
      updatedFrom: undefined,
      updatedTo: undefined,
      page: 1,
      pageSize: 20
    });
  });

  it("parses run trace filters with turn id", () => {
    const filters = parseRunTraceFilters(
      new URLSearchParams({
        turn_id: "turn-1",
        page: "3"
      })
    );

    expect(filters.turnId).toBe("turn-1");
    expect(filters.page).toBe(3);
    expect(filters.pageSize).toBe(20);
  });

  it("falls back to default dashboard window", () => {
    expect(parseDashboardWindow(new URLSearchParams())).toBe("30m");
    expect(parseDashboardWindow(new URLSearchParams({ window: "bad" }))).toBe("30m");
    expect(parseDashboardWindow(new URLSearchParams({ window: "6h" }))).toBe("6h");
  });
});

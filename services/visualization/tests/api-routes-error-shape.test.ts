import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/memory-catalog/service", () => ({
  getMemoryCatalog: vi.fn(async () => {
    throw new Error("boom");
  })
}));

vi.mock("@/features/run-trace/service", () => ({
  getRunTrace: vi.fn(async () => {
    throw new Error("boom");
  })
}));

vi.mock("@/features/dashboard/service", () => ({
  getDashboard: vi.fn(async () => {
    throw new Error("boom");
  })
}));

import { GET as getDashboardRoute } from "@/app/api/dashboard/route";
import { GET as getMemoriesRoute } from "@/app/api/memories/route";
import { GET as getRunsRoute } from "@/app/api/runs/route";

describe("api route error shape", () => {
  it("memories route returns unified error shape", async () => {
    const response = await getMemoriesRoute(
      new Request("http://localhost/api/memories") as any
    );
    const payload = await response.json();

    expect(payload).toEqual({
      error: {
        code: "memory_catalog_failed",
        message: "记忆目录加载失败。"
      }
    });
  });

  it("runs route returns unified error shape", async () => {
    const response = await getRunsRoute(
      new Request("http://localhost/api/runs") as any
    );
    const payload = await response.json();

    expect(payload).toEqual({
      error: {
        code: "run_trace_failed",
        message: "运行轨迹加载失败。"
      }
    });
  });

  it("dashboard route returns unified error shape", async () => {
    const response = await getDashboardRoute(
      new Request("http://localhost/api/dashboard") as any
    );
    const payload = await response.json();

    expect(payload).toEqual({
      error: {
        code: "dashboard_failed",
        message: "看板加载失败。"
      }
    });
  });
});

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    consoleError.mockClear();
  });

  afterEach(() => {
    consoleError.mockClear();
  });

  afterAll(() => {
    consoleError.mockRestore();
  });

  function request(url: string) {
    return { nextUrl: new URL(url) } as any;
  }

  it("memories route returns unified error shape", async () => {
    const response = await getMemoriesRoute(request("http://localhost/api/memories"));
    const payload = await response.json();

    expect(payload).toEqual({
      error: {
        code: "memory_catalog_failed",
        message: "记忆目录加载失败"
      }
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[api] GET /api/memories:",
      expect.objectContaining({ message: "boom" })
    );
  });

  it("runs route returns unified error shape", async () => {
    const response = await getRunsRoute(request("http://localhost/api/runs"));
    const payload = await response.json();

    expect(payload).toEqual({
      error: {
        code: "run_trace_failed",
        message: "运行轨迹加载失败"
      }
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[api] GET /api/runs:",
      expect.objectContaining({ message: "boom" })
    );
  });

  it("dashboard route returns unified error shape", async () => {
    const response = await getDashboardRoute(request("http://localhost/api/dashboard"));
    const payload = await response.json();

    expect(payload).toEqual({
      error: {
        code: "dashboard_failed",
        message: "看板加载失败"
      }
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[api] GET /api/dashboard:",
      expect.objectContaining({ message: "boom" })
    );
  });
});

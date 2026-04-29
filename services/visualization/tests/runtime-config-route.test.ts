import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({
  getAppConfig: () => ({
    values: {
      NEXT_PUBLIC_MNA_DEFAULT_LOCALE: "zh-CN",
      RUNTIME_API_BASE_URL: "http://runtime.test",
    },
    issues: [],
  }),
}));

vi.stubGlobal("fetch", fetchMock);

import { PUT } from "@/app/api/runtime/config/route";

describe("runtime config route", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("proxies governance config updates to retrieval-runtime", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        governance: {
          WRITEBACK_MAINTENANCE_ENABLED: true,
          WRITEBACK_MAINTENANCE_INTERVAL_MS: 1200000,
          WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
          WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
          WRITEBACK_MAINTENANCE_MAX_ACTIONS: 8,
        },
      }),
    });

    const response = await PUT(new Request("http://local.test/api/runtime/config", {
      method: "PUT",
      body: JSON.stringify({
        governance: {
          WRITEBACK_MAINTENANCE_ENABLED: true,
          WRITEBACK_MAINTENANCE_INTERVAL_MS: 1200000,
          WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
          WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
          WRITEBACK_MAINTENANCE_MAX_ACTIONS: 8,
        },
      }),
    }));

    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/v1/runtime/config", "http://runtime.test/"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          governance: {
            WRITEBACK_MAINTENANCE_ENABLED: true,
            WRITEBACK_MAINTENANCE_INTERVAL_MS: 1200000,
            WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
            WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
            WRITEBACK_MAINTENANCE_MAX_ACTIONS: 8,
          },
        }),
      }),
    );
  });
});

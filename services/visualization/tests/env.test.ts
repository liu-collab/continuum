import { afterEach, describe, expect, it } from "vitest";

import { getAppConfig } from "@/lib/env";

const originalPlatformUserId = process.env.PLATFORM_USER_ID;

describe("visualization env", () => {
  afterEach(() => {
    if (originalPlatformUserId === undefined) {
      delete process.env.PLATFORM_USER_ID;
    } else {
      process.env.PLATFORM_USER_ID = originalPlatformUserId;
    }
    globalThis.__AXIS_VIZ_CONFIG__ = undefined;
  });

  it("requires PLATFORM_USER_ID on startup", () => {
    delete process.env.PLATFORM_USER_ID;
    globalThis.__AXIS_VIZ_CONFIG__ = undefined;

    expect(() => getAppConfig()).toThrow("PLATFORM_USER_ID is required");
  });

  it("accepts an explicit platform user id", () => {
    process.env.PLATFORM_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
    globalThis.__AXIS_VIZ_CONFIG__ = undefined;

    expect(getAppConfig().values.PLATFORM_USER_ID).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("defaults the UI locale to English when not configured", () => {
    process.env.PLATFORM_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
    delete process.env.NEXT_PUBLIC_MNA_DEFAULT_LOCALE;
    globalThis.__AXIS_VIZ_CONFIG__ = undefined;

    expect(getAppConfig().values.NEXT_PUBLIC_MNA_DEFAULT_LOCALE).toBe("en-US");
  });
});

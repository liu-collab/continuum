import { describe, expect, it } from "vitest";

import { resolvePlatformUserId } from "../src/platform-user.js";

describe("resolvePlatformUserId", () => {
  it("prefers PLATFORM_USER_ID", () => {
    expect(
      resolvePlatformUserId({
        PLATFORM_USER_ID: "550e8400-e29b-41d4-a716-446655440000",
        MNA_PLATFORM_USER_ID: "550e8400-e29b-41d4-a716-446655440001",
      }),
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("falls back to MNA_PLATFORM_USER_ID and MEMORY_USER_ID", () => {
    expect(resolvePlatformUserId({ MNA_PLATFORM_USER_ID: "550e8400-e29b-41d4-a716-446655440001" })).toBe(
      "550e8400-e29b-41d4-a716-446655440001",
    );
    expect(resolvePlatformUserId({ MEMORY_USER_ID: "550e8400-e29b-41d4-a716-446655440002" })).toBe(
      "550e8400-e29b-41d4-a716-446655440002",
    );
  });

  it("rejects missing or invalid values", () => {
    expect(() => resolvePlatformUserId({})).toThrow("缺少 PLATFORM_USER_ID");
    expect(() => resolvePlatformUserId({ PLATFORM_USER_ID: "not-a-uuid" })).toThrow("PLATFORM_USER_ID 必须是有效 UUID");
  });
});

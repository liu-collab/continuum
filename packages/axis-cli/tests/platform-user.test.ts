import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolvePlatformUserId } from "../src/platform-user.js";

describe("resolvePlatformUserId", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axis-platform-user-"));
    configPath = path.join(tempDir, "platform-user-id.txt");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("prefers PLATFORM_USER_ID", async () => {
    await expect(
      resolvePlatformUserId({
        PLATFORM_USER_ID: "550e8400-e29b-41d4-a716-446655440000",
        MNA_PLATFORM_USER_ID: "550e8400-e29b-41d4-a716-446655440001",
      }, { configPath }),
    ).resolves.toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("falls back to MNA_PLATFORM_USER_ID and MEMORY_USER_ID", async () => {
    await expect(
      resolvePlatformUserId({ MNA_PLATFORM_USER_ID: "550e8400-e29b-41d4-a716-446655440001" }, { configPath }),
    ).resolves.toBe(
      "550e8400-e29b-41d4-a716-446655440001",
    );
    await expect(
      resolvePlatformUserId({ MEMORY_USER_ID: "550e8400-e29b-41d4-a716-446655440002" }, { configPath }),
    ).resolves.toBe(
      "550e8400-e29b-41d4-a716-446655440002",
    );
  });

  it("reuses a persisted local platform user id", async () => {
    await writeFile(
      configPath,
      "550e8400-e29b-41d4-a716-446655440003\n",
      "utf8",
    );

    await expect(resolvePlatformUserId({}, { configPath })).resolves.toBe("550e8400-e29b-41d4-a716-446655440003");
  });

  it("creates a stable local platform user id when env is not set", async () => {
    const first = await resolvePlatformUserId({}, { configPath });
    const second = await resolvePlatformUserId({}, { configPath });
    const persisted = (await readFile(configPath, "utf8")).trim();

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
    expect(persisted).toBe(first);
  });

  it("rejects invalid env or corrupted persisted values", async () => {
    await expect(resolvePlatformUserId({ PLATFORM_USER_ID: "not-a-uuid" }, { configPath })).rejects.toThrow(
      "PLATFORM_USER_ID 必须是有效 UUID",
    );

    await writeFile(configPath, "bad\n", "utf8");
    await expect(resolvePlatformUserId({}, { configPath })).rejects.toThrow("本机 PLATFORM_USER_ID 配置损坏");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const fetchJsonMock = vi.hoisted(() => vi.fn());
const openBrowserMock = vi.hoisted(() => vi.fn());
const pathExistsMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils.js")>();
  return {
    ...actual,
    fetchJson: fetchJsonMock,
    openBrowser: openBrowserMock,
    pathExists: pathExistsMock,
  };
});

import { runUiCommand } from "../src/ui-command.js";

describe("runUiCommand", () => {
  beforeEach(() => {
    process.env.PLATFORM_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
    fetchJsonMock.mockResolvedValue({ ok: false });
    pathExistsMock.mockResolvedValue(true);
    spawnMock.mockReturnValue({
      on: vi.fn(),
    });
  });

  afterEach(() => {
    delete process.env.PLATFORM_USER_ID;
    spawnMock.mockReset();
    fetchJsonMock.mockReset();
    openBrowserMock.mockReset();
    pathExistsMock.mockReset();
  });

  it("passes PLATFORM_USER_ID to standalone visualization", async () => {
    await runUiCommand({}, import.meta.url);

    expect(spawnMock).toHaveBeenCalled();
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({
      env: expect.objectContaining({
        PLATFORM_USER_ID: "550e8400-e29b-41d4-a716-446655440000",
      }),
    });
  });
});

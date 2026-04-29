import { afterEach, describe, expect, it, vi } from "vitest";

const pathExistsMock = vi.hoisted(() => vi.fn());

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils.js")>();
  return {
    ...actual,
    pathExists: pathExistsMock
  };
});

import { runMnaCommand } from "../src/mna-command.js";

describe("axis mna install", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    pathExistsMock.mockReset();
  });

  it("reports vendor ready when vendor directory exists", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    pathExistsMock.mockResolvedValue(true);

    const exitCode = await runMnaCommand("install", {}, import.meta.url);

    expect(exitCode).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("memory-native-agent vendor 已就绪"));
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

const mkdirMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());
const rmMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());
const runCommandMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: mkdirMock,
    readFile: readFileMock,
    rm: rmMock,
    writeFile: writeFileMock,
  };
});

vi.mock("../src/managed-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/managed-state.js")>();
  return {
    ...actual,
    axisManagedDir: vi.fn(() => "C:/Users/test/.axis/managed"),
  };
});

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils.js")>();
  return {
    ...actual,
    runCommand: runCommandMock,
  };
});

import { runRestartCommand } from "../src/restart-command.js";

describe("runRestartCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mkdirMock.mockReset();
    readFileMock.mockReset();
    rmMock.mockReset();
    writeFileMock.mockReset();
    runCommandMock.mockReset();
  });

  it("writes a restart request for runtime", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runCommandMock.mockResolvedValue({
      code: 0,
      stdout: "true\n",
      stderr: "",
    });
    mkdirMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    readFileMock
      .mockRejectedValueOnce(new Error("no error"))
      .mockResolvedValueOnce("runtime 2026-04-29T00:00:00.000Z pid=123\n");

    await expect(runRestartCommand("runtime")).resolves.toBe(0);

    expect(writeFileMock).toHaveBeenCalledWith(
      path.join("C:/Users/test/.axis/managed", "control", "restart-request.txt"),
      "runtime\n",
      "utf8",
    );
  });

  it("rejects unsupported restart targets", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(runRestartCommand("mna")).resolves.toBe(1);
    expect(runCommandMock).not.toHaveBeenCalled();
  });
});

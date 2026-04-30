import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { runRuntimeCommand } from "../src/runtime-command.js";

function createChildProcess() {
  return new EventEmitter();
}

describe("axis runtime command", () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

  it("starts lite runtime by default", async () => {
    spawnMock.mockReturnValue(createChildProcess());

    await runRuntimeCommand(import.meta.url, {});

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining("runtime"), "--lite"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("starts full runtime when requested", async () => {
    spawnMock.mockReturnValue(createChildProcess());

    await runRuntimeCommand(import.meta.url, { full: true });

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining("runtime")],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const rmMock = vi.hoisted(() => vi.fn());
const stopManagedMnaMock = vi.hoisted(() => vi.fn());
const stopLegacyAxisProcessesMock = vi.hoisted(() => vi.fn());
const removeDockerContainerMock = vi.hoisted(() => vi.fn());
const removeDockerImageMock = vi.hoisted(() => vi.fn());
const pruneDanglingDockerImagesMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: rmMock,
  };
});

vi.mock("../src/managed-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/managed-state.js")>();
  return {
    ...actual,
    axisHomeDir: vi.fn(() => "C:/Users/test/.axis"),
  };
});

vi.mock("../src/mna-command.js", () => ({
  stopManagedMna: stopManagedMnaMock,
}));

vi.mock("../src/process-cleanup.js", () => ({
  stopLegacyAxisProcesses: stopLegacyAxisProcessesMock,
}));

vi.mock("../src/docker-lifecycle.js", () => ({
  removeDockerContainer: removeDockerContainerMock,
  removeDockerImage: removeDockerImageMock,
  pruneDanglingDockerImages: pruneDanglingDockerImagesMock,
}));

import { runUninstallCommand } from "../src/uninstall-command.js";

describe("runUninstallCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    rmMock.mockReset();
    stopManagedMnaMock.mockReset();
    stopLegacyAxisProcessesMock.mockReset();
    removeDockerContainerMock.mockReset();
    removeDockerImageMock.mockReset();
    pruneDanglingDockerImagesMock.mockReset();
  });

  it("removes local axis data and docker resources with force", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stopManagedMnaMock.mockResolvedValue(true);
    stopLegacyAxisProcessesMock.mockResolvedValue(undefined);
    removeDockerContainerMock.mockResolvedValue(false);
    removeDockerImageMock.mockResolvedValue(false);
    pruneDanglingDockerImagesMock.mockResolvedValue(true);
    rmMock.mockResolvedValue(undefined);

    await expect(runUninstallCommand({ force: true })).resolves.toBe(0);

    expect(removeDockerContainerMock).toHaveBeenCalledWith("axis-stack");
    expect(removeDockerImageMock).toHaveBeenCalledWith("axis-stack:latest");
    expect(rmMock).toHaveBeenCalledWith(
      "C:/Users/test/.axis",
      expect.objectContaining({ recursive: true, force: true }),
    );
  });

  it("cancels in non-interactive mode without force", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(runUninstallCommand({})).resolves.toBe(1);
    expect(rmMock).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const runCommandMock = vi.hoisted(() => vi.fn());
const portAvailableMock = vi.hoisted(() => vi.fn());
const statfsMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    statfs: statfsMock,
  };
});

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils.js")>();
  return {
    ...actual,
    runCommand: runCommandMock,
  };
});

vi.mock("../src/port-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/port-utils.js")>();
  return {
    ...actual,
    isTcpPortAvailable: portAvailableMock,
  };
});

import { runDoctorCommand } from "../src/doctor-command.js";

describe("runDoctorCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runCommandMock.mockReset();
    portAvailableMock.mockReset();
    statfsMock.mockReset();
  });

  it("prints environment checks and succeeds when required dependencies are ready", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runCommandMock.mockImplementation(async (_command: string, args: string[]) => ({
      code: 0,
      stdout: args.includes("version") ? "Client:\n Server:\n" : "Docker version 1\n",
      stderr: "",
    }));
    portAvailableMock.mockResolvedValue(true);
    statfsMock.mockResolvedValue({
      bavail: BigInt(3 * 1024 * 1024),
      bsize: 1024,
    });

    await expect(runDoctorCommand()).resolves.toBe(0);

    const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("Axis doctor");
    expect(output).toContain("Node.js 22.0+");
    expect(output).toContain("Docker 已安装");
    expect(output).toContain("端口 3001 可用");
    expect(output).toContain("磁盘空间充足");
  });

  it("returns non-zero when a required port is occupied", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runCommandMock.mockImplementation(async (_command: string, args: string[]) => ({
      code: 0,
      stdout: args.includes("version") ? "Client:\n Server:\n" : "Docker version 1\n",
      stderr: "",
    }));
    portAvailableMock.mockImplementation(async (_host: string, port: number) => port !== 3002);
    statfsMock.mockResolvedValue({
      bavail: BigInt(3 * 1024 * 1024),
      bsize: 1024,
    });

    await expect(runDoctorCommand()).resolves.toBe(1);
  });

  it("reports a cross-platform Docker startup hint when daemon is not running", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runCommandMock.mockImplementation(async (_command: string, args: string[]) => ({
      code: args.includes("--version") ? 0 : 1,
      stdout: args.includes("--version") ? "Docker version 1\n" : "",
      stderr: args.includes("--version") ? "" : "daemon unavailable",
    }));
    portAvailableMock.mockResolvedValue(true);
    statfsMock.mockResolvedValue({
      bavail: BigInt(3 * 1024 * 1024),
      bsize: 1024,
    });

    await expect(runDoctorCommand()).resolves.toBe(1);

    const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("Docker 未运行");
    expect(output).toContain("Windows/macOS");
    expect(output).toContain("Docker Engine");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pickWorkspaceDirectoryMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/workspace-picker", () => ({
  pickWorkspaceDirectory: pickWorkspaceDirectoryMock,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();

  return {
    ...actual,
    readFile: readFileMock,
  };
});

vi.mock("@/lib/env", () => ({
  getAppConfig: () => ({
    values: {
      MNA_INTERNAL_BASE_URL: "http://host.docker.internal:4193",
      MNA_TOKEN_PATH: "~/.axis/managed/mna/token.txt",
    },
    issues: [],
  }),
}));

vi.stubGlobal("fetch", fetchMock);

import { POST } from "@/app/api/agent/workspaces/pick/route";

describe("agent workspace picker route", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    readFileMock.mockReset();
  });

  afterEach(() => {
    pickWorkspaceDirectoryMock.mockReset();
  });

  it("proxies to managed mna when internal base url is available", async () => {
    readFileMock.mockResolvedValueOnce("token-123");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cancelled: false,
        workspace: {
          workspace_id: "workspace-1",
          cwd: "C:/workspace/repo",
          label: "repo",
          is_current: false,
        },
      }),
    });

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      cancelled: false,
      workspace: {
        workspace_id: "workspace-1",
        cwd: "C:/workspace/repo",
        label: "repo",
        is_current: false,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pickWorkspaceDirectoryMock).not.toHaveBeenCalled();
  });

  it("falls back to local picker when managed mna proxy is unavailable", async () => {
    readFileMock.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
    pickWorkspaceDirectoryMock.mockResolvedValueOnce("C:/workspace/repo");

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      cancelled: false,
      cwd: "C:/workspace/repo",
    });
  });

  it("returns cancelled when the native picker is dismissed", async () => {
    readFileMock.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
    pickWorkspaceDirectoryMock.mockResolvedValueOnce(null);

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      cancelled: true,
      cwd: null,
    });
  });

  it("returns a typed 400 error for unsupported platforms", async () => {
    readFileMock.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
    pickWorkspaceDirectoryMock.mockRejectedValueOnce(
      Object.assign(new Error("当前系统没有可用的文件夹选择器，请改用手动输入路径。"), {
        code: "workspace_picker_unsupported",
      }),
    );

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: {
        code: "workspace_picker_unsupported",
        message: "当前系统没有可用的文件夹选择器，请改用手动输入路径。",
      },
    });
  });
});

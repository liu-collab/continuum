import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();

  return {
    ...actual,
    readFile: readFileMock
  };
});

vi.mock("@/lib/env", () => ({
  getAppConfig: () => ({
    values: {
      MNA_TOKEN_PATH: "~/.mna/token.txt",
      NEXT_PUBLIC_MNA_BASE_URL: "http://127.0.0.1:4193",
      MNA_INTERNAL_BASE_URL: "http://host.docker.internal:4193"
    },
    issues: []
  })
}));

vi.stubGlobal("fetch", fetchMock);

import { GET } from "@/app/api/agent/token/route";

describe("agent token route", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true
    });
  });

  afterEach(() => {
    readFileMock.mockReset();
    fetchMock.mockReset();
  });

  it("returns ok payload when token file exists", async () => {
    readFileMock.mockResolvedValueOnce("token-123");

    const response = await GET();
    const payload = await response.json();

    expect(payload).toEqual({
      status: "ok",
      token: "token-123",
      reason: null,
      mnaBaseUrl: "http://127.0.0.1:4193"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/healthz", "http://host.docker.internal:4193/"),
      expect.objectContaining({
        method: "GET",
        cache: "no-store"
      })
    );
  });

  it("returns mna_not_running when token file is missing", async () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" });
    readFileMock.mockRejectedValueOnce(error);

    const response = await GET();
    const payload = await response.json();

    expect(payload.status).toBe("mna_not_running");
  });

  it("returns token_missing when token file is empty", async () => {
    readFileMock.mockResolvedValueOnce("   ");

    const response = await GET();
    const payload = await response.json();

    expect(payload).toEqual({
      status: "token_missing",
      token: null,
      reason: "token 文件为空",
      mnaBaseUrl: "http://127.0.0.1:4193"
    });
  });

  it("returns token_missing when token read times out", async () => {
    readFileMock.mockImplementationOnce(
      () => new Promise(() => {
        // keep pending on purpose
      })
    );

    const response = await GET();
    const payload = await response.json();

    expect(payload).toEqual({
      status: "token_missing",
      token: null,
      reason: "读取 token 文件超时",
      mnaBaseUrl: "http://127.0.0.1:4193"
    });
  });

  it("returns token_invalid when token format is invalid", async () => {
    readFileMock.mockResolvedValueOnce("token with spaces");

    const response = await GET();
    const payload = await response.json();

    expect(payload).toEqual({
      status: "token_invalid",
      token: null,
      reason: "token 文件格式不合法",
      mnaBaseUrl: "http://127.0.0.1:4193"
    });
  });

  it("returns token_invalid when token file is not readable", async () => {
    const error = Object.assign(new Error("forbidden"), { code: "EACCES" });
    readFileMock.mockRejectedValueOnce(error);

    const response = await GET();
    const payload = await response.json();

    expect(payload).toEqual({
      status: "token_invalid",
      token: null,
      reason: "没有权限读取 token 文件",
      mnaBaseUrl: "http://127.0.0.1:4193"
    });
  });
});

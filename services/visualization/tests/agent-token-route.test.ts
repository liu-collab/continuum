import { afterEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.hoisted(() => vi.fn());

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
      NEXT_PUBLIC_MNA_BASE_URL: "http://127.0.0.1:4193"
    },
    issues: []
  })
}));

import { GET } from "@/app/api/agent/token/route";

describe("agent token route", () => {
  afterEach(() => {
    readFileMock.mockReset();
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
  });

  it("returns mna_not_running when token file is missing", async () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" });
    readFileMock.mockRejectedValueOnce(error);

    const response = await GET();
    const payload = await response.json();

    expect(payload.status).toBe("mna_not_running");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { archiveMemoryMock } = vi.hoisted(() => ({
  archiveMemoryMock: vi.fn()
}));

vi.mock("@/lib/server/storage-governance-client", () => ({
  archiveMemory: archiveMemoryMock,
  confirmMemory: vi.fn(),
  deleteMemory: vi.fn(),
  invalidateMemory: vi.fn(),
  restoreMemoryVersion: vi.fn()
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
  headers: vi.fn(async () => ({ get: () => undefined }))
}));

import { POST } from "@/app/api/memories/[id]/[action]/route";

function request(body: unknown) {
  return {
    json: vi.fn(async () => body)
  } as never;
}

function context(action: string) {
  return {
    params: Promise.resolve({ id: "memory-1", action })
  };
}

describe("memory governance action route", () => {
  beforeEach(() => {
    archiveMemoryMock.mockReset();
    archiveMemoryMock.mockResolvedValue({
      ok: true,
      action: "archive",
      memoryId: "memory-1",
      message: "submitted",
      upstreamStatus: null,
      sourceStatus: {
        name: "storage_governance_api",
        label: "Storage governance API",
        kind: "dependency",
        status: "healthy",
        checkedAt: null,
        lastCheckedAt: null,
        lastOkAt: null,
        lastError: null,
        responseTimeMs: null,
        detail: null
      }
    });
  });

  it("dispatches a supported governance action", async () => {
    const response = await POST(request({ reason: "done" }), context("archive"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, action: "archive", memoryId: "memory-1" });
    expect(archiveMemoryMock).toHaveBeenCalledWith("memory-1", { reason: "done" }, { locale: "zh-CN" });
  });

  it("returns validation errors before dispatching", async () => {
    const response = await POST(request({ reason: "" }), context("archive"));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("validation_failed");
    expect(archiveMemoryMock).not.toHaveBeenCalled();
  });

  it("returns not found for unknown governance actions", async () => {
    const response = await POST(request({ reason: "done" }), context("unknown"));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("memory_action_not_found");
    expect(archiveMemoryMock).not.toHaveBeenCalled();
  });
});

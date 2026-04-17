import { afterEach, describe, expect, it, vi } from "vitest";

import { archiveMemory, confirmMemory, deleteMemory, editMemory, invalidateMemory } from "@/lib/server/storage-governance-client";

vi.mock("@/lib/env", () => ({
  getAppConfig: () => ({
    values: {
      STORAGE_API_BASE_URL: "http://storage.test",
      STORAGE_API_TIMEOUT_MS: 1000
    }
  })
}));

describe("storage governance client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs confirm request with actor and reason", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    } as Response);

    await confirmMemory("memory-1", { reason: "verified by operator" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://storage.test/v1/storage/records/memory-1/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          actor: { actor_type: "user", actor_id: "visualization" },
          reason: "verified by operator"
        })
      })
    );
  });

  it("constructs edit request with details_json payload", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    } as Response);

    await editMemory("memory-2", {
      reason: "correct the summary",
      summary: "Updated summary",
      details: { foo: "bar" },
      scope: "workspace",
      status: "active"
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://storage.test/v1/storage/records/memory-2",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          actor: { actor_type: "user", actor_id: "visualization" },
          reason: "correct the summary",
          summary: "Updated summary",
          details_json: { foo: "bar" },
          scope: "workspace",
          status: "active"
        })
      })
    );
  });

  it("constructs archive, invalidate, and delete requests against formal routes", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    } as Response);

    await archiveMemory("memory-3", { reason: "no longer needed" });
    await invalidateMemory("memory-3", { reason: "incorrect memory" });
    await deleteMemory("memory-3", { reason: "remove from defaults" });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "http://storage.test/v1/storage/records/memory-3/archive",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "http://storage.test/v1/storage/records/memory-3/invalidate",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "http://storage.test/v1/storage/records/memory-3/delete",
      expect.objectContaining({ method: "POST" })
    );
  });
});

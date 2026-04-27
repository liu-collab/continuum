import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteSessionStore } from "../index.js";

const tempRoots: string[] = [];
const openStores: SqliteSessionStore[] = [];

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-session-store-"));
  tempRoots.push(root);
  const store = new SqliteSessionStore({
    dbPath: path.join(root, "sessions.db"),
  });
  openStores.push(store);
  return store;
}

describe("SqliteSessionStore session CRUD", () => {
  afterEach(() => {
    for (const store of openStores.splice(0)) {
      store.close();
    }
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates, updates, lists, and deletes sessions", () => {
    const store = createStore();

    const session = store.createSession({
      id: "sess-1",
      workspace_id: "ws-1",
      user_id: "user-1",
      memory_mode: "workspace_plus_global",
      locale: "zh-CN",
      title: "Initial title",
    });

    expect(session.id).toBe("sess-1");

    store.updateSession("sess-1", {
      title: "Updated title",
      closed_at: "2026-04-18T00:00:00.000Z",
    });

    const fetched = store.getSession("sess-1");
    expect(fetched?.title).toBe("Updated title");
    expect(fetched?.closed_at).toBe("2026-04-18T00:00:00.000Z");

    const listed = store.listSessions({
      workspace_id: "ws-1",
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.id).toBe("sess-1");

    store.deleteSession("sess-1", {
      purgeArtifacts: false,
    });
    expect(store.getSession("sess-1")).toBeNull();
  });

  it("returns next_cursor and includes the next older row after paging forward", () => {
    const store = createStore();

    store.createSession({
      id: "sess-1",
      workspace_id: "ws-1",
      user_id: "user-1",
      memory_mode: "workspace_plus_global",
      locale: "zh-CN",
      created_at: "2026-04-18T00:00:00.000Z",
    });
    store.createSession({
      id: "sess-2",
      workspace_id: "ws-1",
      user_id: "user-1",
      memory_mode: "workspace_plus_global",
      locale: "zh-CN",
      created_at: "2026-04-19T00:00:00.000Z",
    });

    const firstPage = store.listSessions({
      workspace_id: "ws-1",
      limit: 1,
    });

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]?.id).toBe("sess-2");
    expect(firstPage.next_cursor).toEqual(expect.any(String));

    const secondPage = store.listSessions({
      workspace_id: "ws-1",
      limit: 1,
      cursor: firstPage.next_cursor ?? undefined,
    });

    expect(secondPage.items.map((item) => item.id)).toEqual(["sess-1"]);
    expect(secondPage.next_cursor).toBeNull();
  });

  it("paginates sessions that share the same last_active_at", () => {
    const store = createStore();

    for (const id of ["sess-1", "sess-2", "sess-3"]) {
      store.createSession({
        id,
        workspace_id: "ws-1",
        user_id: "user-1",
        memory_mode: "workspace_plus_global",
        locale: "zh-CN",
        created_at: "2026-04-18T00:00:00.000Z",
      });
    }

    const firstPage = store.listSessions({
      workspace_id: "ws-1",
      limit: 2,
    });

    expect(firstPage.items.map((item) => item.id)).toEqual(["sess-3", "sess-2"]);
    expect(firstPage.next_cursor).toEqual(expect.any(String));

    const secondPage = store.listSessions({
      workspace_id: "ws-1",
      limit: 2,
      cursor: firstPage.next_cursor ?? undefined,
    });

    expect(secondPage.items.map((item) => item.id)).toEqual(["sess-1"]);
    expect(secondPage.next_cursor).toBeNull();
  });

  it("persists resident memory state for a session", () => {
    const store = createStore();

    store.createSession({
      id: "sess-1",
      workspace_id: "ws-1",
      user_id: "user-1",
      memory_mode: "workspace_plus_global",
      locale: "zh-CN",
    });

    store.saveResidentMemoryState("sess-1", {
      resident_memory_json: "{\"summary\":\"typescript\"}",
      resident_memory_dirty: true,
      pending_resident_refresh_job_ids: ["job-1", "job-2"],
    });

    expect(store.getResidentMemoryState("sess-1")).toEqual({
      resident_memory_json: "{\"summary\":\"typescript\"}",
      resident_memory_dirty: true,
      pending_resident_refresh_job_ids: ["job-1", "job-2"],
    });

    store.saveResidentMemoryState("sess-1", {
      resident_memory_json: null,
      resident_memory_dirty: false,
      pending_resident_refresh_job_ids: [],
    });

    expect(store.getResidentMemoryState("sess-1")).toEqual({
      resident_memory_json: null,
      resident_memory_dirty: false,
      pending_resident_refresh_job_ids: [],
    });
  });
});

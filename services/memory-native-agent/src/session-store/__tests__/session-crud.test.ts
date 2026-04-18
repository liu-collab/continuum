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
});

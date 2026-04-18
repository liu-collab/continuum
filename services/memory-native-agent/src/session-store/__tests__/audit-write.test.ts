import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteSessionStore } from "../index.js";

const tempRoots: string[] = [];
const openStores: SqliteSessionStore[] = [];

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-session-audit-"));
  tempRoots.push(root);
  const store = new SqliteSessionStore({
    dbPath: path.join(root, "sessions.db"),
  });
  openStores.push(store);
  return store;
}

describe("SqliteSessionStore tool audit", () => {
  afterEach(() => {
    for (const store of openStores.splice(0)) {
      store.close();
    }
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores tool invocation audits with truncated preview", () => {
    const store = createStore();
    store.createSession({
      id: "sess-1",
      workspace_id: "ws-1",
      user_id: "user-1",
      memory_mode: "workspace_plus_global",
      locale: "zh-CN",
    });
    store.openTurn({
      id: "turn-1",
      session_id: "sess-1",
    });

    store.recordToolInvocation({
      call_id: "call-1",
      session_id: "sess-1",
      turn_id: "turn-1",
      tool_name: "fs_write",
      args_hash: "hash-1",
      args_preview: "x".repeat(600),
      permission_decision: "allowed_once",
      ok: true,
      duration_ms: 42,
      artifact_ref: "sess-1/call-1.txt",
    });

    const fetched = store.getTurn("turn-1");
    expect(fetched?.tool_invocations).toHaveLength(1);
    expect(fetched?.tool_invocations[0]?.args_preview?.length).toBe(512);
    expect(fetched?.tool_invocations[0]?.artifact_ref).toBe("sess-1/call-1.txt");
  });
});

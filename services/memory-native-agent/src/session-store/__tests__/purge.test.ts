import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteSessionStore } from "../index.js";

const tempRoots: string[] = [];
const openStores: SqliteSessionStore[] = [];

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-session-purge-"));
  tempRoots.push(root);
  const artifactsRoot = path.join(root, "artifacts");
  fs.mkdirSync(artifactsRoot, { recursive: true });

  return {
    root,
    artifactsRoot,
    store: (() => {
      const store = new SqliteSessionStore({
        dbPath: path.join(root, "sessions.db"),
        artifactsRoot,
      });
      openStores.push(store);
      return store;
    })(),
  };
}

describe("SqliteSessionStore purge and recovery", () => {
  afterEach(() => {
    for (const store of openStores.splice(0)) {
      store.close();
    }
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("purges session rows and artifact directories", () => {
    const { store, artifactsRoot } = createStore();
    const artifactDir = path.join(artifactsRoot, "sess-1");

    store.createSession({
      id: "sess-1",
      workspace_id: "ws-1",
      user_id: "user-1",
      memory_mode: "workspace_only",
      locale: "en-US",
    });
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, "call-1.txt"), "artifact", "utf8");

    store.deleteSession("sess-1", {
      purgeArtifacts: true,
    });

    expect(store.getSession("sess-1")).toBeNull();
    expect(fs.existsSync(artifactDir)).toBe(false);
  });

  it("marks unfinished turns as crashed on startup recovery", () => {
    const { root, store } = createStore();
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
    store.close();
    openStores.splice(openStores.indexOf(store), 1);

    const recovered = new SqliteSessionStore({
      dbPath: path.join(root, "sessions.db"),
    });
    openStores.push(recovered);
    const changed = recovered.markInterruptedTurnsAsCrashed();

    expect(changed).toBe(1);
    expect(recovered.getTurn("turn-1")?.turn.finish_reason).toBe("crashed");
  });
});

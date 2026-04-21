import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteSessionStore } from "../index.js";

const tempRoots: string[] = [];
const openStores: SqliteSessionStore[] = [];

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-session-messages-"));
  tempRoots.push(root);
  const store = new SqliteSessionStore({
    dbPath: path.join(root, "sessions.db"),
  });
  openStores.push(store);
  return store;
}

describe("SqliteSessionStore message append", () => {
  afterEach(() => {
    for (const store of openStores.splice(0)) {
      store.close();
    }
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists turns, messages, and dispatched message payloads", () => {
    const store = createStore();
    store.createSession({
      id: "sess-1",
      workspace_id: "ws-1",
      user_id: "user-1",
      memory_mode: "workspace_only",
      locale: "en-US",
    });

    const turn = store.openTurn({
      id: "turn-1",
      session_id: "sess-1",
      task_id: "task-1",
    });

    expect(turn.turn_index).toBe(1);

    store.appendMessage({
      id: "msg-1",
      session_id: "sess-1",
      turn_id: "turn-1",
      role: "user",
      content: "hello",
    });
    store.appendMessage({
      id: "msg-2",
      session_id: "sess-1",
      turn_id: "turn-1",
      role: "assistant",
      content: "world",
      token_in: 10,
      token_out: 20,
    });

    store.saveDispatchedMessages("turn-1", {
      messages_json: "[{\"role\":\"user\",\"content\":\"hello\"}]",
      tools_json: "[]",
      prompt_segments_json: "[{\"kind\":\"core_system\",\"priority\":\"fixed\",\"preview\":\"system\"}]",
      provider_id: "openai-compatible",
      model: "gpt-test",
      round: 1,
    });
    store.closeTurn("turn-1", "stop", "trace-1");

    const fetchedTurn = store.getTurn("turn-1");
    expect(fetchedTurn?.messages).toHaveLength(2);
    expect(fetchedTurn?.turn.trace_id).toBe("trace-1");
    expect(store.getDispatchedMessages("turn-1")).toMatchObject({
      provider_id: "openai-compatible",
      round: 1,
      prompt_segments_json: "[{\"kind\":\"core_system\",\"priority\":\"fixed\",\"preview\":\"system\"}]",
    });

    const messages = store.getMessages("sess-1");
    expect(messages).toHaveLength(2);
  });
});

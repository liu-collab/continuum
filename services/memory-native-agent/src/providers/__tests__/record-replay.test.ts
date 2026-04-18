import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RecordReplayProvider } from "../record-replay.js";
import type { ChatRequest, IModelProvider } from "../types.js";

const tempRoots: string[] = [];

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mna-record-replay-"));
  tempRoots.push(dir);
  return dir;
}

class FakeProvider implements IModelProvider {
  id() {
    return "fake";
  }

  model() {
    return "fake-model";
  }

  async *chat(_request: ChatRequest) {
    yield { type: "text_delta", text: "hello" } as const;
    yield {
      type: "end",
      finish_reason: "stop",
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
      },
    } as const;
  }
}

describe("RecordReplayProvider", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("records chunks into a fixture file", async () => {
    const fixtureDir = createTempDir();
    const provider = new RecordReplayProvider({
      fixtureDir,
      fixtureName: "sample",
      mode: "record",
      targetProvider: new FakeProvider(),
    });

    const chunks = [];
    for await (const chunk of provider.chat({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    })) {
      chunks.push(chunk);
    }

    const fixturePath = path.join(fixtureDir, "sample.jsonl");
    expect(chunks).toHaveLength(2);
    expect(fs.existsSync(fixturePath)).toBe(true);
    expect(fs.readFileSync(fixturePath, "utf8")).toContain("\"kind\":\"request\"");
  });

  it("replays chunks from an existing fixture", async () => {
    const fixtureDir = createTempDir();
    const recordedProvider = new RecordReplayProvider({
      fixtureDir,
      fixtureName: "sample",
      mode: "record",
      modelId: "fake-model",
      targetProvider: new FakeProvider(),
    });

    for await (const _chunk of recordedProvider.chat({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    })) {
      // drain recorded chunks
    }

    const provider = new RecordReplayProvider({
      fixtureDir,
      fixtureName: "sample",
      mode: "replay",
      modelId: "fake-model",
    });

    const chunks = [];
    for await (const chunk of provider.chat({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "text_delta", text: "hello" },
      {
        type: "end",
        finish_reason: "stop",
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
    ]);
  });
});

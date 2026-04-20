import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FixtureMissingError, RecordReplayProvider } from "../record-replay.js";
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

  it("throws FixtureMissingError when replay fixture is missing", async () => {
    const fixtureDir = createTempDir();
    const provider = new RecordReplayProvider({
      fixtureDir,
      fixtureName: "missing",
      mode: "replay",
      modelId: "fake-model",
    });

    await expect(
      (async () => {
        for await (const _chunk of provider.chat({
          messages: [{ role: "user", content: "hello" }],
          tools: [],
        })) {
          // no-op
        }
      })(),
    ).rejects.toBeInstanceOf(FixtureMissingError);
  });

  it("throws FixtureMissingError when replay fixture key does not match", async () => {
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

    const replayProvider = new RecordReplayProvider({
      fixtureDir,
      fixtureName: "sample",
      mode: "replay",
      modelId: "fake-model",
    });

    await expect(
      (async () => {
        for await (const _chunk of replayProvider.chat({
          messages: [{ role: "user", content: "different request" }],
          tools: [],
        })) {
          // no-op
        }
      })(),
    ).rejects.toBeInstanceOf(FixtureMissingError);
  });

  it("replays multiple recorded provider calls in order from the same fixture file", async () => {
    const fixtureDir = createTempDir();
    const recordedProvider = new RecordReplayProvider({
      fixtureDir,
      fixtureName: "multi-turn",
      mode: "record",
      modelId: "fake-model",
      targetProvider: new FakeProvider(),
    });

    for await (const _chunk of recordedProvider.chat({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    })) {
      // drain first request
    }

    for await (const _chunk of recordedProvider.chat({
      messages: [{ role: "user", content: "hello again" }],
      tools: [],
    })) {
      // drain second request
    }

    const replayProvider = new RecordReplayProvider({
      fixtureDir,
      fixtureName: "multi-turn",
      mode: "replay",
      modelId: "fake-model",
    });

    const firstReplay = [];
    for await (const chunk of replayProvider.chat({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    })) {
      firstReplay.push(chunk);
    }

    const secondReplay = [];
    for await (const chunk of replayProvider.chat({
      messages: [{ role: "user", content: "hello again" }],
      tools: [],
    })) {
      secondReplay.push(chunk);
    }

    expect(firstReplay).toEqual([
      { type: "text_delta", text: "hello" },
      {
        type: "end",
        finish_reason: "stop",
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
    ]);
    expect(secondReplay).toEqual(firstReplay);
  });
});

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { DEFAULT_FIXTURE_DIR } from "../shared/constants.js";
import type { ChatChunk, ChatRequest, IModelProvider, ToolSchema } from "./types.js";

type RecordReplayMode = "live" | "record" | "replay";

type RecordReplayOptions = {
  fixtureDir?: string;
  fixtureName?: string;
  mode?: RecordReplayMode;
  modelId?: string;
  targetProvider?: IModelProvider;
};

type RequestRecord = {
  kind: "request";
  key: string;
  model: string;
  tools: string[];
  messages_digest: string;
  tools_digest: string;
};

type ChunkRecord = {
  kind: "chunk";
  data: ChatChunk;
};

type FixtureRecord = RequestRecord | ChunkRecord;

type FixtureMatch = {
  chunks: ChatChunk[];
  nextOffset: number;
};

export class FixtureMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixtureMissingError";
  }
}

export class RecordReplayProvider implements IModelProvider {
  private readonly fixtureDir: string;
  private readonly fixtureName: string;
  private readonly mode: RecordReplayMode;
  private readonly modelId?: string;
  private readonly targetProvider?: IModelProvider;
  private replayOffset = 0;

  constructor(options: RecordReplayOptions = {}) {
    this.fixtureDir = options.fixtureDir ?? DEFAULT_FIXTURE_DIR;
    this.fixtureName = options.fixtureName ?? "default";
    this.mode = options.mode ?? resolveModeFromEnv(process.env);
    this.modelId = options.modelId;
    this.targetProvider = options.targetProvider;
  }

  id(): string {
    return "record-replay";
  }

  model(): string {
    return this.modelId ?? this.targetProvider?.model() ?? "record-replay";
  }

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    if (this.mode === "live") {
      if (!this.targetProvider) {
        throw new FixtureMissingError("record-replay live mode requires a target provider.");
      }

      for await (const chunk of this.targetProvider.chat(request)) {
        yield chunk;
      }
      return;
    }

    const key = buildFixtureKey(this.model(), request.messages, request.tools ?? []);

    if (this.mode === "replay") {
      const records = await readFixture(path.join(this.fixtureDir, `${this.fixtureName}.jsonl`));
      const matched = findFixtureMatch(records, key, this.replayOffset);
      if (!matched) {
        throw new FixtureMissingError(
          `Fixture mismatch for key ${key}. Run with MNA_PROVIDER_MODE=record to re-record.`,
        );
      }

      this.replayOffset = matched.nextOffset;

      for (const chunk of matched.chunks) {
        yield chunk;
      }
      return;
    }

    if (!this.targetProvider) {
      throw new FixtureMissingError("record mode requires a target provider.");
    }

    const chunks: ChatChunk[] = [];
    for await (const chunk of this.targetProvider.chat(request)) {
      chunks.push(chunk);
      yield chunk;
    }

    const requestRecord: RequestRecord = {
      kind: "request",
      key,
      model: this.targetProvider.model(),
      tools: (request.tools ?? []).map((tool) => tool.name).sort(),
      messages_digest: digestJson(normalizeMessages(request.messages)),
      tools_digest: digestJson(normalizeTools(request.tools ?? [])),
    };

    await appendFixture(path.join(this.fixtureDir, `${this.fixtureName}.jsonl`), [
      requestRecord,
      ...chunks.map(
        (chunk): ChunkRecord => ({
          kind: "chunk",
          data: chunk,
        }),
      ),
    ]);
  }
}

async function readFixture(filePath: string): Promise<FixtureRecord[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new FixtureMissingError(`Fixture file not found: ${filePath}`);
    }
    throw error;
  }
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as FixtureRecord);
}

async function appendFixture(filePath: string, records: FixtureRecord[]) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function normalizeMessages(messages: ChatRequest["messages"]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.trim(),
    tool_calls: message.tool_calls?.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      args: stableSortObject(toolCall.args),
    })),
    tool_call_id: message.tool_call_id,
  }));
}

function normalizeTools(tools: ToolSchema[]) {
  return [...tools]
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: stableSortObject(tool.parameters),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildFixtureKey(model: string, messages: ChatRequest["messages"], tools: ToolSchema[]) {
  const messagesDigest = digestJson(normalizeMessages(messages));
  const toolsDigest = digestJson(normalizeTools(tools));
  return digestJson({
    model,
    messages_digest: messagesDigest,
    tools_digest: toolsDigest,
  });
}

function resolveModeFromEnv(env: NodeJS.ProcessEnv): RecordReplayMode {
  const mode = env.MNA_PROVIDER_MODE;
  if (mode === "record" || mode === "replay") {
    return mode;
  }

  return "live";
}

function digestJson(value: unknown) {
  const serialized = JSON.stringify(stableSortObject(value));
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

function stableSortObject<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stableSortObject(item)) as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, stableSortObject(nestedValue)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}

function findFixtureMatch(records: FixtureRecord[], key: string, offset: number): FixtureMatch | null {
  for (let index = offset; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.kind !== "request" || record.key !== key) {
      continue;
    }

    const chunks: ChatChunk[] = [];
    let cursor = index + 1;
    while (cursor < records.length && records[cursor]?.kind !== "request") {
      const next = records[cursor];
      if (next?.kind === "chunk") {
        chunks.push(next.data);
      }
      cursor += 1;
    }

    return {
      chunks,
      nextOffset: cursor,
    };
  }

  return null;
}

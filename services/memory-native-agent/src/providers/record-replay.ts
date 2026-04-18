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
      const header = records.find((record): record is RequestRecord => record.kind === "request");
      if (!header || header.key !== key) {
        throw new FixtureMissingError(
          `Fixture mismatch for key ${key}. Run with MNA_PROVIDER_MODE=record to re-record.`,
        );
      }

      for (const record of records) {
        if (record.kind === "chunk") {
          yield record.data;
        }
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

    await writeFixture(path.join(this.fixtureDir, `${this.fixtureName}.jsonl`), [
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
  const content = await fs.readFile(filePath, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as FixtureRecord);
}

async function writeFixture(filePath: string, records: FixtureRecord[]) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
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
